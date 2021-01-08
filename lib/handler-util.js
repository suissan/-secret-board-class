'use strict';
const fs = require('fs');

function handleLogout(req, res) {
  res.writeHead(401, {
    'Content-Type': 'text/html; charset=utf-8'
  });
  res.end(`<!DOCTYPE html><html lang="ja"><body>
    <h1>ログアウトしました</h1>
    <a href="/posts">ログイン</a>
    </body></html>`);
}

function handleNotFound(req, res) {
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8'
  });
  res.end('<h1>ページが見つかりません。</h1>');
}

function handleBadRequest(req, res) {
  res.writeHead(400, {
    'Content-Type': 'text/html; charset=utf-8'
  });
  res.end('<h1>未対応のリクエストです。</h1>');
}

function handleFavicon(req, res) {
  res.writeHead(200, {
    'Content-Type': 'image/vnd.microsoft.ico'
  });
  const favicon = fs.readFileSync('./favicon.ico');
  res.end(favicon);
}

module.exports = {
  handleLogout,
  handleNotFound,
  handleBadRequest,
  handleFavicon
};