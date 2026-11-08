/* ─── Agenda search — parallel of the useState/search filter inside
 * views/AgendaView.tsx. The server renders every event in
 * `data-search-text` (lowercased title + description); this script
 * hides/shows rows + their parent sections as the user types.
 */
(function () {
  if (window.__KuiCalendarAgenda) return;
  window.__KuiCalendarAgenda = true;

  function onInput(ev) {
    var input = ev.target;
    if (!input || !input.matches || !input.matches('[data-cal-agenda-search]')) return;
    var agenda = input.closest('[data-cal-agenda]');
    if (!agenda) return;
    var q = (input.value || '').trim().toLowerCase();
    var rows = agenda.querySelectorAll('[data-cal-agenda-row]');
    for (var i = 0; i < rows.length; i++) {
      var match = !q || (rows[i].getAttribute('data-search-text') || '').indexOf(q) !== -1;
      rows[i].closest('li').style.display = match ? '' : 'none';
    }
    // Hide a whole section when none of its rows match.
    var sections = agenda.querySelectorAll('[data-cal-agenda-section]');
    for (var j = 0; j < sections.length; j++) {
      var anyVisible = false;
      var lis = sections[j].querySelectorAll('li');
      for (var k = 0; k < lis.length; k++) {
        if (lis[k].style.display !== 'none') { anyVisible = true; break; }
      }
      sections[j].style.display = anyVisible ? '' : 'none';
    }
  }

  document.addEventListener('input', onInput);
})();
