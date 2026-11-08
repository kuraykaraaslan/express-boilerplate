// modules/ui/DatePicker/scripts/locale-tr.js
// Türkçe locale for the DatePicker EJS module.
//
// TODO M3: lazy-load on demand.
(function () {
  if (typeof window === 'undefined') return;
  window.KUI_DATEPICKER_LOCALE = window.KUI_DATEPICKER_LOCALE || {};
  window.KUI_DATEPICKER_LOCALE.tr = {
    code: 'tr',
    months: [
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ],
    monthsShort: [
      'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
      'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'
    ],
    // TR: Monday-first week.
    weekdaysShort: ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'],
    weekStartsOn: 1,
    displayFormat: 'DD.MM.YYYY',
    messages: {
      placeholder: 'GG.AA.YYYY',
      prevMonth: 'Önceki ay',
      nextMonth: 'Sonraki ay',
      today: 'Bugün',
      clear: 'Tarihi temizle',
      dialogLabel: 'Tarih seçin',
      disabledDate: 'Bu tarih seçilemez'
    }
  };
})();
