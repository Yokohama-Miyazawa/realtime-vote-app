# リアルタイム投票アプリ

## 準備

```bash
$ npm install
```

## 動かし方

```bash
$ node index.js
```

ポート番号3100で動き始めます。

## 使い方

ブラウザで以下のURLを開くとランキング画面が表示されます。

```
http://[リアルタイム投票アプリを動かしているサーバーのIPアドレス]:3100/ranking
```

## 投票方法

以下のコマンドで１票投票できます。

```bash
$ curl -X POST -d '{"ranking-title":"投票したいタイトル名"}' --header "content-type:application/json" http://localhost:3100/count/up
```

ドラスクリプトで動かすには以下のようにします。

```
/.payload.ranking-title/投票したいタイトル名
/http.post/http://[リアルタイム投票アプリを動かしているサーバーのIPアドレス]:3100/count/up
```

## API

- /count/up

  １票投票します。

- /count/down

  投票を１票取り下げます。

- /count/reset

  投票を0にリセットします。

- /count/delete

  投票項目を削除します。
