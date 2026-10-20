(function () {
  "use strict";

  var root = document.documentElement;
  var themeButton = document.querySelector(".theme-toggle");
  var savedTheme = null;

  try { savedTheme = localStorage.getItem("landon-theme"); } catch (_) {}

  var preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  setTheme(savedTheme === "dark" || savedTheme === "light" ? savedTheme : preferredTheme);

  function setTheme(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (!themeButton) return;
    var next = theme === "dark" ? "light" : "dark";
    themeButton.setAttribute("aria-label", "Switch to " + next + " theme");
    themeButton.title = "Switch to " + next + " theme";
  }

  if (themeButton) {
    themeButton.addEventListener("click", function () {
      var next = root.dataset.theme === "dark" ? "light" : "dark";
      setTheme(next);
      try { localStorage.setItem("landon-theme", next); } catch (_) {}
    });
  }

  /* --------------------------------------------------- same-document links

     The nav's "Home" and the footer byline both point at
     index.html. On index.html that is a full document reload: the watercolor
     canvas is torn down and reseeded, the panel's settings were (until the
     companion change in watercolor/main.js) thrown away, and the reader is
     teleported to the top with no transition — while sibling in-page links
     scroll smoothly. Links in one nav behaving differently is the actual
     complaint.

     Fixed by predicate rather than by selector: any anchor whose resolved URL
     is THIS document (same path and query, hash ignored) is a scroll, not a
     navigation. That is what keeps the nav symmetric now that its entries are
     on the same document. The hero entry point (when restored), scroll cue,
     and footer byline take that path too. It automatically stops covering
     anything from the about.html /
     portfolio.html redirect stubs, where index.html genuinely IS a different
     document.

     Left alone deliberately: modified clicks — a middle-click or ctrl-click on
     the wordmark still opens a real tab, because that is what the reader asked
     for. Smoothness is NOT specified here either: the scrolls below omit
     `behavior`, which resolves to the element's computed `scroll-behavior`, so
     they inherit styles.css:77 and its reduced-motion override at styles.css:390
     exactly as the section links do. One definition of "does
     this page glide", in the stylesheet, where the media query already lives. */
  function samePage(a) {
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return false;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (_) { return false; }
    if (url.origin !== location.origin) return false;
    if (url.pathname !== location.pathname) return false;
    // An href with NO query of its own means "this document, wherever you are":
    // nav Home and the footer byline are both a bare `index.html`.
    // Comparing that strictly against a live `?seed=7&panel=open` made both
    // fall through to a REAL navigation — which then dropped the query on the
    // floor, i.e. the exact reload-and-lose-your-composition this handler exists
    // to prevent, just hidden behind a URL nobody tests with. An href that does
    // carry a query (index.html?seed=9) still navigates: a different query is a
    // different composition, and the reader asked for it.
    return url.search === "" || url.search === location.search;
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var a = event.target.closest ? event.target.closest('a[href]') : null;
    if (!a || !samePage(a)) return;
    var hash = new URL(a.getAttribute('href'), location.href).hash;
    var target = hash ? document.querySelector(hash) : null;
    if (hash && !target) return;   // dangling anchor: let the browser answer for it
    event.preventDefault();
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
    // Keep the address bar honest without adding a history entry per click:
    // going "home" should drop a stale #about, and the query string (?seed=,
    // ?panel=open) has to survive because it is what pins the composition.
    var next = location.pathname + location.search + (target ? hash : '');
    if (next !== location.pathname + location.search + location.hash) {
      history.replaceState(null, '', next);
    }
    // Focus follows the scroll or the page becomes keyboard-hostile: without
    // this, Tab after clicking a home link resumes from wherever the reader
    // was, not from the top.
    var focusTarget = target || document.querySelector('.site-header a');
    if (focusTarget) {
      var hadTabIndex = focusTarget.hasAttribute('tabindex');
      if (!hadTabIndex && focusTarget !== document.activeElement) focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
      if (!hadTabIndex) focusTarget.removeAttribute('tabindex');
    }
  });

  /* ------------------------------------------------------------------ nav */

  var navs = [];
  document.querySelectorAll(".site-nav").forEach(function (nav) {
    var highlight = nav.querySelector(".nav-highlight");
    var current = nav.querySelector('[aria-current="page"]');
    var links = Array.prototype.slice.call(nav.querySelectorAll("a"));

    function pointAt(link, immediate) {
      if (!link || !highlight) return;
      nav.classList.toggle("nav-immediate", !!immediate);
      highlight.style.setProperty("--nav-x", link.offsetLeft + "px");
      highlight.style.setProperty("--nav-w", link.offsetWidth + "px");
      highlight.style.opacity = "1";
      if (immediate) requestAnimationFrame(function () { nav.classList.remove("nav-immediate"); });
    }

    function restore() { pointAt(current, false); }
    links.forEach(function (link) {
      link.addEventListener("pointerenter", function () { pointAt(link, false); });
      link.addEventListener("focus", function () { pointAt(link, false); });
    });
    nav.addEventListener("pointerleave", restore);
    nav.addEventListener("focusout", function (event) {
      if (!nav.contains(event.relatedTarget)) restore();
    });
    pointAt(current, true);
    window.addEventListener("resize", function () { pointAt(current, true); });

    // All nav entries are on the same document, so the resting pill has
    // to follow the reader instead of the URL. aria-current="page" stays on the
    // real page link (Home) — an in-page section is not a different page — and
    // the highlight is a purely visual scroll-spy on top of it.
    navs.push({
      spy: function (key) {
        var next = key
          ? nav.querySelector('[data-spy="' + key + '"]')
          : nav.querySelector(".nav-here");
        if (!next || next === current) return;
        current = next;
        links.forEach(function (l) { l.classList.toggle("nav-spy-active", l === next); });
        if (!nav.matches(":hover") && !nav.contains(document.activeElement)) restore();
      },
    });
  });

  /* ------------------------------------------------------- one-page descent
     Two ways to produce --sp (see the comment block in styles.css). Native
     scroll-driven animation is preferred and attaches NO scroll listener at
     all; the rAF fallback exists only for engines without it. */

  var reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  var journey = document.querySelector(".home-main");

  if (journey) {
    // Arriving already below the fold — a section deep link, a restored scroll
    // position — must not play the hero's entrance at a hero nobody can see.
    // Checked twice because neither check alone is enough: this script is
    // `defer`, so at parse time scrollY is still 0 for a fragment navigation
    // (the browser scrolls after layout), and `location.hash` says nothing
    // about a restored position.
    var markDeepLoad = function () {
      if (window.scrollY > 8) root.classList.add("wc-deep-load");
    };
    // A fragment whose target is missing or `hidden` (a deferred section such
    // as #about) has nowhere to land: the browser stays at the top, so treat
    // it as a plain visit — drop the stale hash and keep the hero's entrance.
    if (location.hash && location.hash !== "#main-content") {
      var hashId = location.hash.slice(1);
      try { hashId = decodeURIComponent(hashId); } catch (_) {}
      var hashTarget = document.getElementById(hashId);
      if (!hashTarget || hashTarget.closest("[hidden]")) {
        history.replaceState(history.state, "", location.pathname + location.search);
        window.scrollTo(0, 0);
      } else {
        root.classList.add("wc-deep-load");
      }
    }
    markDeepLoad();
    window.addEventListener("load", markDeepLoad);

    var nativeTimeline =
      window.CSS && CSS.supports && CSS.supports("animation-timeline", "scroll()");

    if (nativeTimeline) {
      root.classList.add("wc-native-timeline");
    } else {
      // The native path's range is `0 100vh`, and CSS `vh` is the LARGE
      // viewport — it does not move when a mobile URL bar collapses. Measuring
      // against window.innerHeight instead would make --sp jump ~10% mid-scroll
      // on the first phone that hides its chrome (a visible pop in the hero's
      // fade), and would put the fallback and the native path on two different
      // definitions of "one viewport". This probe reads the same 100vh the
      // keyframe uses; it is measured out of line and cached, never per frame.
      var probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText =
        "position:absolute;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none";
      document.body.appendChild(probe);
      var vhPx = 1, lastW = -1;
      var measureVh = function () {
        // Only on a real width change: a height-only resize is the URL bar.
        if (window.innerWidth === lastW) return;
        lastW = window.innerWidth;
        vhPx = probe.offsetHeight || window.innerHeight || 1;
      };
      measureVh();

      var ticking = false;
      var lastSp = -1;
      var writeSp = function () {
        ticking = false;
        if (reduceMQ.matches) return;
        var sp = window.scrollY / vhPx;
        sp = sp < 0 ? 0 : sp > 1 ? 1 : sp;
        // Rounded so an identical value is not restyled 60 times a second while
        // the wheel coasts through the last few pixels of a viewport.
        sp = Math.round(sp * 1000) / 1000;
        if (sp === lastSp) return;
        lastSp = sp;
        root.style.setProperty("--sp", String(sp));
      };
      var onScroll = function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(writeSp);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", function () { measureVh(); onScroll(); }, { passive: true });
      reduceMQ.addEventListener("change", function () {
        if (reduceMQ.matches) { root.style.removeProperty("--sp"); lastSp = -1; }
        else onScroll();
      });
      writeSp();
    }
  }

  /* ---------------------------------------------------- project-card video
     The poster is the default, not a loading placeholder. Video sources stay
     inert in data-src attributes until a hover-capable, non-reduced-motion
     reader asks for motion. That keeps the 250 KB pair off phones and out of
     the initial page load; pointer leave and focus loss return to frame zero. */
  var desmosVideo = document.querySelector(".desmos-video");
  var desmosLink = desmosVideo && desmosVideo.closest("a.project-visual");
  var motionPointerMQ = window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)");

  if (desmosVideo && desmosLink) {
    var desmosLoaded = false;
    var desmosHovered = false;
    var desmosFocused = false;

    function loadDesmosVideo() {
      if (desmosLoaded) return;
      desmosVideo.querySelectorAll("source[data-src]").forEach(function (source) {
        source.src = source.dataset.src;
      });
      desmosLoaded = true;
      desmosVideo.load();
    }

    function desmosActive() {
      return motionPointerMQ.matches && (desmosHovered || desmosFocused);
    }

    function desmosKeyboardFocused() {
      try { return desmosLink.matches(":focus-visible"); } catch (_) { return false; }
    }

    function startDesmosVideo() {
      var started = desmosVideo.play();
      if (started && started.catch) started.catch(function () {});
    }

    function playDesmosVideo() {
      if (!desmosActive()) return;
      loadDesmosVideo();
      startDesmosVideo();
    }

    function resetDesmosVideo() {
      if (desmosActive()) return;
      desmosVideo.pause();
      try { desmosVideo.currentTime = 0; } catch (_) {}
    }

    desmosVideo.addEventListener("canplay", function () {
      if (desmosActive()) startDesmosVideo();
    });
    desmosLink.addEventListener("pointerenter", function (event) {
      if (event.pointerType === "touch") return;
      desmosHovered = true;
      playDesmosVideo();
    });
    desmosLink.addEventListener("pointerleave", function () {
      desmosHovered = false;
      resetDesmosVideo();
    });
    desmosLink.addEventListener("focus", function () {
      desmosFocused = desmosKeyboardFocused();
      playDesmosVideo();
    });
    desmosLink.addEventListener("blur", function () {
      desmosFocused = false;
      resetDesmosVideo();
    });
    motionPointerMQ.addEventListener("change", resetDesmosVideo);
  }

  /* -------------------------------------------------------------- entrances */

  var reveals = document.querySelectorAll(".reveal");
  if (reveals.length && "IntersectionObserver" in window) {
    // Only now is it safe for the CSS to start anything at opacity 0.
    root.classList.add("js-reveal");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);   // one-way: re-running on every scroll-by reads as jitter
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.01 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------------------- scroll spy */

  // Every sheet below the hero, in document order. The list is derived from the
  // nav itself rather than hard-coded, so adding a fourth movement is one <a
  // data-spy> plus one <section id> and nothing here changes.
  var spied = [];
  document.querySelectorAll(".site-nav a[data-spy]").forEach(function (a) {
    var key = a.getAttribute("data-spy");
    var el = document.getElementById(key);
    if (el && spied.every(function (s) { return s.el !== el; })) spied.push({ key: key, el: el });
  });
  spied.sort(function (a, b) {
    return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  if (spied.length && navs.length && "IntersectionObserver" in window) {
    // One observer over all sheets, still with no scroll listener. rootMargin
    // collapses the root to the viewport's middle line, so "intersecting" means
    // "this sheet owns the middle". The sheets are adjacent and non-overlapping,
    // so normally exactly one qualifies — but the callback is only given the
    // entries that CHANGED, so the answer has to be accumulated across calls
    // rather than read off entries[0]. At an exact boundary two can report in,
    // and the later one in document order wins: the reader is descending into
    // it. `wc-past-hero` is any of them, which is what the hero's
    // pointer-events gate needs (styles.css) — keying it on about alone would
    // switch the invisible hero's clicks back on down in portfolio.
    var live = new WeakSet();
    var io2 = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) live.add(e.target); else live.delete(e.target);
      });
      var key = null;
      spied.forEach(function (s) { if (live.has(s.el)) key = s.key; });
      root.classList.toggle("wc-past-hero", !!key);
      navs.forEach(function (n) { n.spy(key); });
    }, { rootMargin: "-50% 0px -50% 0px", threshold: 0 });
    spied.forEach(function (s) { io2.observe(s.el); });
  }
})();
