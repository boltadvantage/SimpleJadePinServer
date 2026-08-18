/* Shared page wiring. Kept in a file (not inline) so the Content-Security-Policy
 * can forbid inline script entirely — which is what neutralises an injected
 * event handler such as `<img onerror=...>`. */
(function () {
  "use strict";

  window.addEventListener("DOMContentLoaded", function () {
    // External links never open in this window. The desktop shell hands them to
    // the system browser; a plain browser opens a normal tab.
    document.querySelectorAll('a[href^="https://"]').forEach(function (a) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });

    // Oracle page: default the primary URL to wherever this page is served from.
    var urla = document.getElementById("urla");
    if (urla) urla.value = window.location.protocol + "//" + window.location.host;

    // Handlers that were inline onclick attributes before the CSP forbade them.
    var gen = document.getElementById("btn_generate");
    if (gen) gen.addEventListener("click", function () { generate(); });

    var goOracle = document.getElementById("btn_goto_oracle");
    if (goOracle) goOracle.addEventListener("click", function () {
      location.href = "oracle_qr.html";
    });

    var pick = document.getElementById("btn_pick_file");
    if (pick) pick.addEventListener("click", function () {
      document.getElementById("file_input").click();
    });
  });
})();
