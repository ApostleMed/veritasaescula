/* ===== VAI forms: where applications are sent =========================
   sheetEndpoint is the Google Apps Script web-app URL (it ends in /exec).
   Every pre-registration and scholarship application is posted to it, added
   to the Google Sheet and emailed to the admissions inbox.

   If the script is ever re-deployed as a NEW deployment, its URL changes and
   must be replaced here. Editing an existing deployment keeps the same URL.
   ====================================================================== */
window.VAI_FORM = {
  sheetEndpoint: 'https://script.google.com/macros/s/AKfycbwMx_mGOmMTbbn2B3EPl6HJUNQmJntdeN5S5fn3WmKQtq14kxD-WbVj1xIACx4St8xVvQ/exec'
};
