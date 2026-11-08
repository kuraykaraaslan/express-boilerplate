// modules/ui/DatePicker/scripts/locale-en.js
// English locale for the DatePicker EJS module.
//
// TODO M3: ship as a `<script>` lazy-load so non-EN pages don't ship EN text.
(function () {
  if (typeof window === 'undefined') return;
  window.KUI_DATEPICKER_LOCALE = window.KUI_DATEPICKER_LOCALE || {};
  window.KUI_DATEPICKER_LOCALE.en = {
    code: 'en',
    months: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ],
    monthsShort: [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ],
    // EN: Sunday-first week.
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    weekStartsOn: 0,
    displayFormat: 'MM/DD/YYYY',
    messages: {
      placeholder: 'MM/DD/YYYY',
      prevMonth: 'Previous month',
      nextMonth: 'Next month',
      today: 'Today',
      clear: 'Clear date',
      dialogLabel: 'Choose date',
      disabledDate: 'Disabled date'
    }
  };
})();
