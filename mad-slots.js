/* ===== MAD scholarship places: edit this number only ===== */
window.MAD_SLOTS_TOTAL = 11;
window.MAD_SLOTS_LEFT  = 11;
/* ========================================================== */

(function () {
  var total = window.MAD_SLOTS_TOTAL || 11;
  var left = Math.max(0, Math.min(total, window.MAD_SLOTS_LEFT == null ? total : window.MAD_SLOTS_LEFT));
  var taken = total - left;

  document.querySelectorAll('[data-mad-seats]').forEach(function (el) {
    el.innerHTML = '';
    for (var i = 1; i <= total; i++) {
      var s = document.createElement('span');
      s.className = 'mad-seat ' + (i <= taken ? 'is-taken' : 'is-open');
      s.textContent = i;
      el.appendChild(s);
    }
    el.setAttribute('aria-label', left + ' of ' + total + ' places left');
  });

  document.querySelectorAll('[data-mad-left]').forEach(function (el) {
    el.textContent = left === 0
      ? 'All ' + total + ' places have been awarded'
      : (left === 1 ? 'Last place left' : left + ' of ' + total + ' places left');
  });

  if (left === 0) {
    document.querySelectorAll('[data-mad-open]').forEach(function (el) { el.hidden = true; });
    document.querySelectorAll('[data-mad-closed]').forEach(function (el) { el.hidden = false; });
  }
})();
