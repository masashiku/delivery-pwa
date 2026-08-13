/* 売上入力（第1段階） */
var CONF_KEY = 'dpwa_conf';
var COMPANY_KEY = 'dpwa_last_company';
var state = { date: null, manual: false, sales: [], company: null, lastConfirm: null };

function $(id) { return document.getElementById(id); }
function fmtDate(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
    '-' + ('0' + d.getDate()).slice(-2);
}
function todayStr() { return fmtDate(new Date()); }
function jpDate(s) {
  var p = s.split('-');
  return Number(p[0]) + '年' + Number(p[1]) + '月' + Number(p[2]) + '日';
}
function loadConf() {
  try { return JSON.parse(localStorage.getItem(CONF_KEY) || 'null'); } catch (e) { return null; }
}
function localKey(d) { return 'dpwa_sales_' + d; }
function saveLocal() { localStorage.setItem(localKey(state.date), JSON.stringify(state.sales)); }
function loadLocal(d) {
  try { return JSON.parse(localStorage.getItem(localKey(d)) || '[]'); } catch (e) { return []; }
}
function newId() { return 'r' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

/* 通信 */
function postOnce(payload) {
  var c = loadConf();
  if (!c) return Promise.reject(new Error('接続設定がありません'));
  return fetch(c.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function (r) { return r.text(); })
    .then(function (t) {
      var d = JSON.parse(t);
      if (d.error === 'get_not_supported' || d.error === 'no_body') {
        throw new Error('応答が失われました');
      }
      return d;
    });
}

/* 応答が失われた場合は当日一覧を取得し、request_id があるかで成否を判断する */
function sendSale(item) {
  var c = loadConf();
  return postOnce({
    token: c.token, action: 'saveSale', request_id: item.request_id,
    delivery_date: item.date, delivery_time: item.time,
    company_code: item.company, amount: item.amount
  }).catch(function (e1) {
    return new Promise(function (res) { setTimeout(res, 1200); })
      .then(function () { return postOnce({ token: c.token, action: 'listSales', delivery_date: item.date }); })
      .then(function (d) {
        var hit = (d.sales || []).filter(function (s) { return s.request_id === item.request_id; })[0];
        if (hit) return { ok: true, sale: hit };
        throw e1;
      });
  });
}

/* 未送信をまとめて送る */
function flush() {
  var pending = state.sales.filter(function (s) { return !s.synced; });
  if (!pending.length || !loadConf()) { render(); return; }
  var i = 0;
  (function next() {
    if (i >= pending.length) { saveLocal(); render(); return; }
    var item = pending[i++];
    sendSale(item).then(function (d) {
      if (d.ok) { item.synced = true; item.sale_id = d.sale.sale_id; }
      saveLocal(); render(); next();
    }).catch(function () { saveLocal(); render(); });
  })();
}

/* サーバー側の当日データを取り込む */
function syncFromServer() {
  var c = loadConf();
  if (!c) return;
  postOnce({ token: c.token, action: 'listSales', delivery_date: state.date })
    .then(function (d) {
      if (!d.ok) return;
      var known = {};
      d.sales.forEach(function (s) {
        known[s.request_id] = true;
      });
      var pending = state.sales.filter(function (s) { return !s.synced && !known[s.request_id]; });
      state.sales = d.sales.map(function (s) {
        return {
          request_id: s.request_id, sale_id: s.sale_id, date: s.delivery_date,
          time: s.delivery_time, company: s.company_code, amount: s.amount, synced: true
        };
      }).concat(pending);
      saveLocal(); render();
    }).catch(function () {});
}

/* 時刻の検証 */
function parseTime(v) {
  if (!/^\d{4}$/.test(v)) return null;
  var h = Number(v.slice(0, 2)), m = Number(v.slice(2));
  if (h > 23 || m > 59) return null;
  return v.slice(0, 2) + ':' + v.slice(2);
}

/* 表示更新 */
function render() {
  $('date').value = state.date;
  var isToday = state.date === todayStr();
  $('dateNote').style.display = isToday ? 'none' : 'block';
  $('dateNote').textContent = '過去日のデータを入力中：' + jpDate(state.date);
  $('backToday').style.display = isToday ? 'none' : 'inline-block';

  Array.prototype.forEach.call(document.querySelectorAll('.companies button'), function (b) {
    b.className = (b.dataset.code === state.company) ? 'on' : '';
  });

  var sorted = state.sales.slice().sort(function (a, b) {
    return (a.date + a.time) < (b.date + b.time) ? -1 : 1;
  });
  var last = state.sales[state.sales.length - 1];
  $('last').textContent = last
    ? jpDate(last.date).replace('年', '/').replace('月', '/').replace('日', '') +
      ' ' + last.time + '　' + last.company + '　' + last.amount + '円　' +
      (last.synced ? '同期済み' : '未送信')
    : '（まだありません）';

  var total = 0;
  sorted.forEach(function (s) { total += Number(s.amount); });
  var count = sorted.length;
  var pending = state.sales.filter(function (s) { return !s.synced; }).length;

  $('sum').innerHTML =
    '<div class="sum"><span>現在の売上</span><span>' + total + ' 円</span></div>' +
    '<div class="sum"><span>配達件数</span><span>' + count + ' 件</span></div>' +
    '<div class="sum"><span>平均単価</span><span>' +
      (count ? Math.round(total / count) : 0) + ' 円</span></div>' +
    (pending ? '<div class="sum pending"><span>未送信</span><span>' + pending + ' 件</span></div>' : '');

  $('list').innerHTML = sorted.map(function (s) {
    return '<tr><td>' + s.time + '</td><td>' + s.company + '</td>' +
      '<td class="r">' + s.amount + '円</td>' +
      '<td class="r">' + (s.synced ? '' : '未送信') + '</td></tr>';
  }).join('');
}

/* 日付の切り替え */
function setDate(d, manual) {
  state.date = d;
  state.manual = !!manual;
  state.sales = loadLocal(d);
  render();
  syncFromServer();
}

/* 確定 */
function confirmSale() {
  $('msg').textContent = '';
  var raw = $('time').value.replace(/\D/g, '');
  if (raw.length === 3) raw = '0' + raw;
  var time = parseTime(raw);
  if (!time) { $('msg').textContent = '時間が正しくありません。'; return; }

  var amtRaw = $('amount').value.trim();
  if (amtRaw === '' || !/^\d+$/.test(amtRaw)) {
    $('msg').textContent = '金額を0以上の整数で入力してください。'; return;
  }
  var amount = Number(amtRaw);
  if (!state.company) { $('msg').textContent = '会社を選択してください。'; return; }

  // 直前と同じ内容が3秒以内なら確認する
  var sig = state.date + time + state.company + amount;
  var now = Date.now();
  if (state.lastConfirm && state.lastConfirm.sig === sig &&
      now - state.lastConfirm.at < 3000) {
    if (!window.confirm('直前と同じ内容です。そのまま登録しますか？')) return;
  }
  state.lastConfirm = { sig: sig, at: now };

  var item = {
    request_id: newId(), date: state.date, time: time,
    company: state.company, amount: amount, synced: false
  };
  state.sales.push(item);
  saveLocal();

  $('time').value = '';
  $('amount').value = '';
  $('time').focus();
  render();
  flush();
}

/* 初期化 */
window.addEventListener('DOMContentLoaded', function () {
  setDate(todayStr(), false);
  state.company = localStorage.getItem(COMPANY_KEY) || null;
  render();

  $('date').addEventListener('change', function () {
    if (/^\d{4}-\d{2}-\d{2}$/.test(this.value)) setDate(this.value, true);
  });
  $('backToday').onclick = function () { setDate(todayStr(), false); };

  $('time').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 4);
    if (this.value.length === 4 && parseTime(this.value)) $('amount').focus();
  });
  // 3桁は入力途中の可能性があるため、離れた時点で0を補う
  $('time').addEventListener('blur', function () {
    var v = this.value.replace(/\D/g, '');
    if (v.length === 3) this.value = '0' + v;
  });

  Array.prototype.forEach.call(document.querySelectorAll('.companies button'), function (b) {
    b.onclick = function () {
      state.company = b.dataset.code;
      localStorage.setItem(COMPANY_KEY, state.company);
      render();
    };
  });

  $('confirm').onclick = confirmSale;
  $('resend').onclick = flush;

  // 0時を過ぎたら日付を切り替える（手動変更中は行わない）
  setInterval(function () {
    if (!state.manual && state.date !== todayStr()) setDate(todayStr(), false);
  }, 30000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
});
