const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const QRCode = require('qrcode');
const app = express();
const config = {
  counter: 0,
  projects: [],
}

const PORT = process.env.PORT || 3100
const PICT = path.join(__dirname, 'public/images');
const QR_CODE_BASE_URL = process.env.QR_CODE_BASE_URL || 'http://localhost:3000';
const QR_CODE_SECRET = process.env.QR_CODE_SECRET || 'keyboard cat';
const QR_CODE_PROJECT_DATA_PATH = process.env.QR_CODE_PROJECT_DATA_PATH || path.join(__dirname, 'project-data.json');

const countVote = (v) => { let a = 0; Object.keys(v).forEach( t => { a += v[t].point; } ); return a; }

const hash = (id) => {
  return crypto.createHmac('sha256', QR_CODE_SECRET)
    .update(id)
    .digest('hex')
    .slice(-8);
}

let saveTimeout = null;
let doSave = false;
const saveProjectInfo = () => {
  if (!saveTimeout) {
    doSave = false;
    const save = () => {
      const data = { projects: [ ...config.projects, ], counter: config.counter, };
      fs.writeFile(QR_CODE_PROJECT_DATA_PATH, JSON.stringify(data,null,'  '), (err) => {
        if (doSave) save();
      })
    }
    save()
  } else {
    doSave = true;
  }
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
  }, 1000);
}

const loadProjectInfoSync = () => {
  try {
    const conf = JSON.parse(fs.readFileSync(QR_CODE_PROJECT_DATA_PATH).toString());
    if (conf.projects) config.projects = conf.projects;
    if (conf.counter) config.counter = conf.counter;
  } catch(err) {
  }
}
loadProjectInfoSync();

const updateRanking = (callback) => {
  const pj = {};
  config.projects.forEach( (v, i) => {
    pj[v.id] = { ...v, index: i+1, };
  });
  sessionStore.all(function(err, result) {
    Object.keys(result).forEach( id => {
      const session = result[id];
      if (session.user) {
        if (session.user.vote) {
          Object.keys(session.user.vote).forEach( id => {
            const v = session.user.vote[id];
            pj[id].point += v.point;
          });
        }
      }
    });
    if (callback) callback(Object.keys(pj).map( k => pj[k] ));
  });
}

const allVoteSession = (callback) => {
  const r = {}
  sessionStore.all(function(err, result) {
    Object.keys(result).forEach( id => {
      r[hash(id)] = result[id].user;
    });
    if (callback) callback(r);
  });
}

const sessionStore = new MemoryStore({
  checkPeriod: 86400000 // prune expired entries every 24h
});

app.use((req, res, next) => {
  console.log(`# ${(new Date()).toLocaleString()} ${req.ip} ${req.url}`);
  next();
});

app.use(bodyParser.json({ type: 'application/json' }))
app.use(bodyParser.raw({ type: 'application/*' }))

app.use(express.static('public'))
app.use('/images', express.static(PICT))

app.set('trust proxy', true)
app.use(session({
  store: sessionStore,
  secret: QR_CODE_SECRET,
  resave: false,
  proxy: true,
  saveUninitialized: false,
}))

app.use((req, res, next) => {
  console.log("SessionID: " + req.sessionID);
  next();
});

app.post('/qrcode', (req, res) => {
  QRCode.toDataURL(`${QR_CODE_BASE_URL}${req.body.string}`, function (err, url) {
    res.json({
      qrcode: url,
    });
  })
});

//curl -X POST http://localhost:3100/allVoteSession
app.post('/allVoteSession', (req, res) => {
  allVoteSession((r) => {
    res.json(r);
  })
});

app.post('/projects', (req, res) => {
console.log(config.projects);
  updateRanking((pj) => {
    res.json(pj);
  });
});

app.post('/project', (req, res) => {
  if (config.projects.some( v => {
    if (v.id == req.body.projectId) {
      res.json(v);
      return true;
    }
    return false;
  })) {
    return;
  }
  res.json({ status: `not found projectId ${req.body.projectId}` });
});

app.post('/reset', (req, res) => {
  const sessionId = req.session.id;
  req.session.user = { vote: {} };
  updateRanking(() => {
    Object.keys(rankingSocket).forEach( key => {
      rankingSocket[key].emit('updated', { sessionId: hash(sessionId), action: 'reset' });
    });
  });
  res.send({ state: 'logined', vote: countVote(req.session.user.vote), });
});

app.post('/recept', (req, res) => {
  const sessionId = req.session.id;
  if (typeof req.session.user !== 'undefined') {
    const voteCount = countVote(req.session.user.vote);
    if (voteCount < 3) {
      Object.keys(rankingSocket).forEach( key => {
        rankingSocket[key].emit('updated', { sessionId: hash(sessionId), action: 'recept' });
      });
      res.send({ state: 'logined', vote: countVote(req.session.user.vote), });
      return;
    }
  } else {
    req.session.user = { vote: {} };
    updateRanking(() => {
      Object.keys(rankingSocket).forEach( key => {
        rankingSocket[key].emit('updated', { sessionId: hash(sessionId), action: 'recept' });
      });
    });
  }
  res.send({ state: 'logined', vote: countVote(req.session.user.vote), });
});

app.post('/vote', (req, res) => {
console.log(req.body);
  const sessionId = req.session.id;
  const projectId = req.body.projectId;
  if (typeof req.session.user !== 'undefined') {
    const voteCount = countVote(req.session.user.vote);
    if (voteCount < 3) {
      if (typeof req.session.user.vote[projectId] === 'undefined') {
        req.session.user.vote[projectId] = { point: 0 };
      }
      req.session.user.vote[projectId].point ++;
      Object.keys(rankingSocket).forEach( key => {
        rankingSocket[key].emit('updated', { sessionId: hash(sessionId), projectId, action: 'vote' });
      });
    } else {
      Object.keys(rankingSocket).forEach( key => {
        rankingSocket[key].emit('updated', { sessionId: hash(sessionId), projectId, action: 'end' });
      });
      res.send({ state: 'end', vote: countVote(req.session.user.vote), });
      return;
    }
    res.send({ state: 'logined', vote: countVote(req.session.user.vote), });
    return;
  }
  res.send({ state: 'not login', });
});

app.post('/status', (req, res) => {
  const payload = {
    ...req.session.user,
  };
  if (typeof req.session.user !== 'undefined') {
    payload.state = 'logined';
  } else {
    payload.state = 'not login';
  }
  res.json(payload);
});

app.post('/count/:action', (req, res) => {
  console.log(JSON.stringify(req.body));
  try {
    const title = req.body['ranking-title'];
    if (title) {
      if (req.params.action == 'delete') {
        const p = [];
        config.projects.forEach( v => {
          if (v.title.join('') === title) {
          } else {
            p.push(v);
          }
        });
        config.projects = p;
      } else {
        if (!config.projects.some( v => {
          if (v.title.join('') === title) {
            if (req.params.action === 'up') {
              v.point ++;
            } else
            if (req.params.action === 'down') {
              v.point --;
            } else
            if (req.params.action === 'reset') {
              v.point = 0;
            }
            return true;
          }
          return false;
        })) {
          config.projects.push({
            id: ('00000000'+config.counter).slice(-8),
            title: [title],
            point: (req.params.action === 'reset') ? 0 : 1,
          });
          config.projects.forEach( (v, i) => {
            v.index = i;
          })
          config.counter ++;
          if (config.counter >= 100000000) {
            config.counter = 0;
          }
          saveProjectInfo();
        }
      }
      Object.keys(rankingSocket).forEach( key => {
        rankingSocket[key].emit('updated');
      });
      res.send('OK\n');
    } else {
      res.send('Err\n');
    }
  } catch(err) {
    console.log(err);
    res.send('Err\n');
  }
});

const indexHTML = fs.readFileSync(path.join(__dirname,'/public/index.html'));

app.get('/health', (req, res) => {
  res.send('OK');
});

app.get('/', (req, res) => {
  res.redirect('/recept');
});

app.get('/*', (req, res) => {
  const sessionId = req.session.id;
  Object.keys(rankingSocket).forEach( key => {
    rankingSocket[key].emit('updated', { sessionId: hash(sessionId), });
  });
  res.set('Content-Type', 'text/html');
  res.send(indexHTML);
});

const server = require('http').Server(app);
const io = require('socket.io')(server);

server.listen(PORT, () => console.log(`qr code system listening on port ${PORT}!`))

const rankingSocket = {};

io.on('connection', function (socket) {
  socket.on('disconnect', () => {
console.log('disconnect' , socket.id);
    delete rankingSocket[socket.id];
  })
  socket.on('reload', (callback) => {
console.log('reload' , socket.id);
    rankingSocket[socket.id] = socket;
    updateRanking((pj) => {
      if (callback) callback(pj);
    });
  })
  socket.on('reload-raw', (callback) => {
console.log('reload-raw' , socket.id);
    rankingSocket[socket.id] = socket;
    const pj = config.projects;
    if (callback) callback(Object.keys(pj).map( k => pj[k] ));
  })
});
