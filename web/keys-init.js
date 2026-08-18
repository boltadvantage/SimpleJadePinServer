/* Keys & backup page. External file so the CSP can forbid inline script. */
(function () {
  "use strict";

  function setText(id, text) {
    var e = document.getElementById(id);
    if (e) e.textContent = text;
  }

  window.addEventListener("DOMContentLoaded", function () {
    fetch("status").then(function (r) { return r.json(); }).then(function (s) {
      // Every value here is set as text, never markup.
      setText("data_dir", s.data_dir);
      setText("pub_key", s.public_key);
      setText("pin_records", s.pin_records + (s.pin_records === 1 ? " record" : " records"));
      setText("backup_paths", s.data_dir);

      if (s.keys_created_this_run) {
        document.getElementById("new_key_warning").style.display = "block";
      }
      if (s.migrated_from) {
        document.getElementById("migrated_notice").style.display = "block";
        setText("migrated_path",
          "Imported from " + s.migrated_from + " — the original was left in place.");
      }
    }).catch(function () {
      setText("data_dir", "Could not reach the local server.");
    });

    document.getElementById("btn_open").addEventListener("click", function () {
      if (window.boltJade && window.boltJade.openDataDir) {
        window.boltJade.openDataDir();
      } else {
        setText("open_hint",
          "Only available in the desktop app — copy the path above instead.");
      }
    });
  });
})();
