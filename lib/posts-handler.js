'use strict';
const crypto = require('crypto');
const pug = require('pug');
const Cookies = require('cookies');
const util = require('./handler-util');
const Post = require('./post');
const moment = require('moment-timezone');

const trackingIdKey = 'tracking_id';

const oneTimeTokenMap = new Map(); // キーをユーザー名、値をトークンとする連想配列

function handle(req, res) {
  const cookies = new Cookies(req, res);
  const trackingId = addTrackingCookie(cookies, req.user);
  switch (req.method) {
    case 'GET':
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      // データベースへの読み出し
      Post.findAll({ order: [['id', 'DESC']] }).then((posts) => { // findAll() によって pug で全てのデータベースのデータが参照できる
        // 表示データの編集
        posts.forEach(post => {
          post.content = post.content.replace(/うんち/g, '禁句だぞ…').replace(/\+/g, ' ');
          post.formattedCreatedAt = moment(post.createdAt).tz('Asia/Tokyo').format('YYYY年MM月DD日 HH時mm分ss秒');
        });
        // CSRF トークン発行
        const oneTimeToken = crypto.randomBytes(8).toString('hex');
        console.log(typeof req.user);
        oneTimeTokenMap.set(req.user, oneTimeToken);
        console.log(`oneTimeTokenMap: ${Array.from(oneTimeTokenMap)}`);
        // pug でHTML を生成
        res.end(pug.renderFile('./views/posts.pug', {
          posts: posts,
          user: req.user,
          oneTimeToken: oneTimeToken
        }));
        // ログ
        console.info(
          `閲覧されました:
          user: ${req.user},
          userAgent: ${req.headers['user-agent']},
          trakcingId: ${trackingId},
          remoteAddress: ${req.connection.remoteAddress}`
        );
      });
      break;
    case 'POST':
      let body = [];
      req.on('data', (chunk) => {
        // バイナリデータの断片で取得するので配列に詰め込む
        body.push(chunk);
      }).on('end', () => {
        // バイナリデータの配列をまとめて文字列に変換する
        body = Buffer.concat(body).toString(); // concat は chunk で送られてきたデータを繋げてる
        // URIエンコードされた状態なので、デコードする
        const decoded = decodeURIComponent(body);
        console.log(`decoded: ${decoded}`);
        const matchResult = decoded.match(/content=(.*)&oneTimeToken=(.*)/);
        console.log(`matchResult: ${matchResult}`);
        if (matchResult) {
          const content = matchResult[1];
          const requestedOneTimeToken = matchResult[2];
          if (oneTimeTokenMap.get(req.user) === requestedOneTimeToken) {
            console.info('投稿されました: ' + content);
            Post.create({
              content: content,
              trackingCookie: trackingId,
              postedBy: req.user
            }).then(() => {
              // oneTimeToken を削除
              oneTimeTokenMap.delete(req.user);
              // /postsにリダイレクト
              handleRedirectPosts(req, res);
            });
          } else {
            // CSRFトークンが不正
            util.handleBadRequest(req, res);
          }
        } else {
          // パラメータ不足、もしくは不正
          util.handleBadRequest(req, res);
        }
      });
      break;
    default:
      // 想定外のリクエストメソッド
      util.handleBadRequest(req, res);
      break;
  }
}

function handleDelete(req, res) {
  switch (req.method) {
    case 'POST':
      let body = [];
      req.on('data', (chunk) => {
        body.push(chunk);
      }).on('end', () => {
        body = Buffer.concat(body).toString();
        const decoded = decodeURIComponent(body);
        console.log(`decoded: ${decoded}`);
        const matchResult = decoded.match(/id=(.*)&oneTimeToken=(.*)/);
        console.log(`matchResult: ${matchResult}`);
        if (matchResult) {
          const id = matchResult[1];
          const requestedOneTimeToken = matchResult[2];
          if (oneTimeTokenMap.get(req.user) === requestedOneTimeToken) {
            Post.findByPk(id).then((post) => {
              if (req.user === post.postedBy || req.user === 'admin') {
                post.destroy().then(() => {
                  console.info(
                    `削除されました:
                    user: ${req.user},
                    userAgent: ${req.headers['user-agent']},
                    remoteAddress: ${req.connection.remoteAddress}`
                  );
                  oneTimeTokenMap.delete(req.user);
                  handleRedirectPosts(req, res);
                });
              }
            });
          } else {
            // CSRFトークンが不正
            util.handleBadRequest(req, res);
          }
        } else {
          // パラメータ不足、もしくは不正
          util.handleBadRequest(req, res);
        }
      });
      break;
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

/**
 * Cookieに含まれているトラッキングIDに異常がなければその値を返し、
 * 存在しない場合や異常なものである場合には、再度作成しCookieに付与してその値を返す
 * @param {Cookies} cookies
 * @param {String} userName
 * @return {String} トラッキングID
 */
function addTrackingCookie(cookies, userName) {
  const requestedTrackingId = cookies.get(trackingIdKey);
  console.log(`requestedTrackingId: ${requestedTrackingId}`);
  if (isValidTrackingId(requestedTrackingId, userName)) {
    // TrackingIDそのまま使う
    return requestedTrackingId;
  } else {
    // TrackingID作り直し
    const originalId = parseInt(crypto.randomBytes(8).toString('hex'), 16);
    console.log(typeof originalId);
    const tomorrow = new Date(Date.now() + (1000 * 60 * 60 * 24));
    const trackingId = originalId + '_' + createValidHash(originalId, userName);
    cookies.set(trackingIdKey, trackingId, { expires: tomorrow });
    return trackingId;
  }
}

function isValidTrackingId(trackingId, userName) {
  if (!trackingId) { // !false((IDがない)状態がtrueだからfalseが返ってくる)  !true((IDがある)状態がfalseだから下の処理にいく)
    // TrackingIDが未設定
    return false;
  }
  const splitted = trackingId.split('_');
  const originalId = splitted[0];
  const requestedHash = splitted[1];
  return createValidHash(originalId, userName) === requestedHash;
}

const secretKey =
  '5a69bb55532235125986a0df24aca759f69bae045c7a66d6e2bc4652e3efb43da4' +
  'd1256ca5ac705b9cf0eb2c6abb4adb78cba82f20596985c5216647ec218e84905a' +
  '9f668a6d3090653b3be84d46a7a4578194764d8306541c0411cb23fbdbd611b5e0' +
  'cd8fca86980a91d68dc05a3ac5fb52f16b33a6f3260c5a5eb88ffaee07774fe2c0' +
  '825c42fbba7c909e937a9f947d90ded280bb18f5b43659d6fa0521dbc72ecc9b4b' +
  'a7d958360c810dbd94bbfcfd80d0966e90906df302a870cdbffe655145cc4155a2' +
  '0d0d019b67899a912e0892630c0386829aa2c1f1237bf4f63d73711117410c2fc5' +
  '0c1472e87ecd6844d0805cd97c0ea8bbfbda507293beebc5d9';

function createValidHash(originalId, userName) {
  const sha1sum = crypto.createHash('sha1');
  sha1sum.update(originalId + userName + secretKey);
  return sha1sum.digest('hex');
}

function handleRedirectPosts(req, res) {
  res.writeHead(303, {
    'Location': '/posts'
  });
  res.end();
}

module.exports = {
  handle,
  handleDelete
};