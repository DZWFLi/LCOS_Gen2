/* Masonic 4.1.0 and its original dependencies.
 * Source: https://github.com/jaredLunde/masonic
 * Bundled unchanged; React remains the existing G2 runtime.
 * Original notices and licenses retained in ./LICENSES.
 */

// output/frontend-component-runtime/masonic/node_modules/masonic/dist/esm/index.mjs
import * as C from "react";

// output/frontend-component-runtime/masonic/node_modules/@react-hook/debounce/dist/module/index.js
import * as React2 from "react";

// output/frontend-component-runtime/masonic/node_modules/@react-hook/latest/dist/module/index.js
import * as React from "react";
var useLatest = (current) => {
  const storedValue = React.useRef(current);
  React.useEffect(() => {
    storedValue.current = current;
  });
  return storedValue;
};
var module_default = useLatest;

// output/frontend-component-runtime/masonic/node_modules/@react-hook/debounce/dist/module/index.js
var useDebounceCallback = (callback, wait = 100, leading = false) => {
  const storedCallback = module_default(callback);
  const timeout = React2.useRef();
  const deps = [wait, leading, storedCallback];
  function _ref2() {
    timeout.current && clearTimeout(timeout.current);
    timeout.current = void 0;
  }
  React2.useEffect(() => _ref2, deps);
  function _ref22() {
    timeout.current = void 0;
  }
  return React2.useCallback(function() {
    const args = arguments;
    const {
      current
    } = timeout;
    if (current === void 0 && leading) {
      timeout.current = setTimeout(_ref22, wait);
      return storedCallback.current.apply(null, args);
    }
    current && clearTimeout(current);
    timeout.current = setTimeout(() => {
      timeout.current = void 0;
      storedCallback.current.apply(null, args);
    }, wait);
  }, deps);
};
var useDebounce = (initialState, wait, leading) => {
  const state = React2.useState(initialState);
  return [state[0], useDebounceCallback(state[1], wait, leading)];
};

// output/frontend-component-runtime/masonic/node_modules/@react-hook/event/dist/module/index.js
import * as React3 from "react";
function useEvent(target, type, listener, cleanup) {
  const storedListener = React3.useRef(listener);
  const storedCleanup = React3.useRef(cleanup);
  React3.useEffect(() => {
    storedListener.current = listener;
    storedCleanup.current = cleanup;
  });
  React3.useEffect(() => {
    const targetEl = target && "current" in target ? target.current : target;
    if (!targetEl) return;
    let didUnsubscribe = 0;
    function listener2(...args) {
      if (didUnsubscribe) return;
      storedListener.current.apply(this, args);
    }
    targetEl.addEventListener(type, listener2);
    const cleanup2 = storedCleanup.current;
    return () => {
      didUnsubscribe = 1;
      targetEl.removeEventListener(type, listener2);
      cleanup2 && cleanup2();
    };
  }, [target, type]);
}
var module_default2 = useEvent;

// output/frontend-component-runtime/masonic/node_modules/@react-hook/window-size/dist/module/index.js
var emptyObj = {};
var win = typeof window === "undefined" ? null : window;
var wv = win && typeof win.visualViewport !== "undefined" ? win.visualViewport : null;
var getSize = () => [document.documentElement.clientWidth, document.documentElement.clientHeight];
var useWindowSize = function(options) {
  if (options === void 0) {
    options = emptyObj;
  }
  const {
    wait,
    leading,
    initialWidth = 0,
    initialHeight = 0
  } = options;
  const [size, setDebouncedSize] = useDebounce(
    /* istanbul ignore next */
    typeof document === "undefined" ? [initialWidth, initialHeight] : getSize,
    wait,
    leading
  );
  const setSize = () => setDebouncedSize(getSize);
  module_default2(win, "resize", setSize);
  module_default2(wv, "resize", setSize);
  module_default2(win, "orientationchange", setSize);
  return size;
};

// output/frontend-component-runtime/masonic/node_modules/@essentials/memoize-one/dist/module/index.js
var memoOne = (fn, areEqual) => {
  const equal = areEqual || defaultAreEqual;
  let args, value;
  return function() {
    return !!args && equal(arguments, args) ? value : value = fn.apply(null, args = arguments);
  };
};
var module_default3 = memoOne;
var defaultAreEqual = (current, prev) => current[0] === prev[0] && current[1] === prev[1] && current[2] === prev[2] && current[3] === prev[3];

// output/frontend-component-runtime/masonic/node_modules/@essentials/one-key-map/dist/module/index.js
var OneKeyMap = class {
  constructor() {
    this.set = void 0;
    this.get = void 0;
    let key, val;
    this.get = (k) => k === key ? val : void 0;
    this.set = (k, v2) => {
      key = k;
      val = v2;
    };
  }
};
var module_default4 = OneKeyMap;

// output/frontend-component-runtime/masonic/node_modules/trie-memoize/dist/module/index.js
var createCache = (obj) => {
  try {
    return new obj();
  } catch (e2) {
    const cache = {};
    return {
      set(k, v2) {
        cache[k] = v2;
      },
      get(k) {
        return cache[k];
      }
    };
  }
};
var memo = (constructors) => {
  const depth = constructors.length, baseCache = createCache(constructors[0]);
  let base;
  let map;
  let i2;
  let node;
  const one = depth === 1;
  const g1 = (args) => (base = baseCache.get(args[0])) === void 0 || one ? base : base.get(args[1]);
  const s1 = (args, value) => {
    if (one) baseCache.set(args[0], value);
    else {
      if ((base = baseCache.get(args[0])) === void 0) {
        map = createCache(constructors[1]);
        map.set(args[1], value);
        baseCache.set(args[0], map);
      } else {
        base.set(args[1], value);
      }
    }
    return value;
  };
  const g2 = (args) => {
    node = baseCache;
    for (i2 = 0; i2 < depth; i2++) if ((node = node.get(args[i2])) === void 0) return;
    return node;
  };
  const s2 = (args, value) => {
    node = baseCache;
    for (i2 = 0; i2 < depth - 1; i2++) {
      if ((map = node.get(args[i2])) === void 0) {
        map = createCache(constructors[i2 + 1]);
        node.set(args[i2], map);
        node = map;
      } else {
        node = map;
      }
    }
    node.set(args[depth - 1], value);
    return value;
  };
  return depth < 3 ? {
    g: g1,
    s: s1
  } : {
    g: g2,
    s: s2
  };
};
var memoize = (mapConstructors, fn) => {
  let item;
  const {
    g: g2,
    s: s2
  } = memo(mapConstructors);
  return function() {
    return (item = g2(arguments)) === void 0 ? s2(arguments, fn.apply(null, arguments)) : item;
  };
};
var module_default5 = memoize;

// output/frontend-component-runtime/masonic/node_modules/@essentials/raf/dist/module/index.js
var u = "undefined";
var win2 = typeof window !== u ? window : {};
var p = typeof performance !== u ? performance : Date;
var now = () => p.now();
var af = "AnimationFrame";
var Caf = "cancel" + af;
var Raf = "request" + af;
var raf = win2[Raf] && /* @__PURE__ */ win2[Raf].bind(win2);
var caf = win2[Caf] && /* @__PURE__ */ win2[Caf].bind(win2);
function _ref(h2) {
  return clearTimeout(h2);
}
if (!raf || !caf) {
  let lastTime = 0;
  raf = (callback) => {
    let curr = now(), next = Math.max(lastTime + 1e3 / 60, curr);
    return setTimeout(() => {
      callback(lastTime = next);
    }, next - curr);
  };
  caf = _ref;
}

// output/frontend-component-runtime/masonic/node_modules/@essentials/request-timeout/dist/module/index.js
var clearRequestTimeout = (handle) => {
  caf(handle.v || -1);
};
var requestTimeout = (fn, ms) => {
  const start = now(), handle = {};
  const loop = () => {
    now() - start >= ms ? fn.call(null) : handle.v = raf(loop);
  };
  handle.v = raf(loop);
  return handle;
};

// output/frontend-component-runtime/masonic/node_modules/@react-hook/throttle/dist/module/index.js
import * as React4 from "react";
var perf = typeof performance !== "undefined" ? performance : Date;
var now2 = () => perf.now();
function useThrottleCallback(callback, fps = 30, leading = false) {
  const storedCallback = module_default(callback);
  const ms = 1e3 / fps;
  const prev = React4.useRef(0);
  const trailingTimeout = React4.useRef();
  const clearTrailing = () => trailingTimeout.current && clearTimeout(trailingTimeout.current);
  const deps = [fps, leading, storedCallback];
  function _ref2() {
    prev.current = 0;
    clearTrailing();
  }
  React4.useEffect(() => _ref2, deps);
  return React4.useCallback(function() {
    const args = arguments;
    const rightNow = now2();
    const call = () => {
      prev.current = rightNow;
      clearTrailing();
      storedCallback.current.apply(null, args);
    };
    const current = prev.current;
    if (leading && current === 0) return call();
    if (rightNow - current > ms) {
      if (current > 0) return call();
      prev.current = rightNow;
    }
    clearTrailing();
    trailingTimeout.current = setTimeout(() => {
      call();
      prev.current = 0;
    }, ms);
  }, deps);
}
function useThrottle(initialState, fps, leading) {
  const state = React4.useState(initialState);
  return [state[0], useThrottleCallback(state[1], fps, leading)];
}

// output/frontend-component-runtime/masonic/node_modules/@react-hook/window-scroll/dist/module/index.js
var win3 = typeof window === "undefined" ? null : window;
var getScrollY = () => win3.scrollY !== void 0 ? win3.scrollY : win3.pageYOffset === void 0 ? 0 : win3.pageYOffset;
var useWindowScroll = (fps = 30) => {
  const state = useThrottle(typeof window === "undefined" ? 0 : getScrollY, fps, true);
  module_default2(win3, "scroll", () => state[1](getScrollY()));
  return state[0];
};
var module_default6 = useWindowScroll;

// output/frontend-component-runtime/masonic/node_modules/@react-hook/passive-layout-effect/dist/module/index.js
import React5 from "react";
var usePassiveLayoutEffect = React5[typeof document !== "undefined" && document.createElement !== void 0 ? "useLayoutEffect" : "useEffect"];
var module_default7 = usePassiveLayoutEffect;

// output/frontend-component-runtime/masonic/node_modules/raf-schd/dist/raf-schd.esm.js
var rafSchd = function rafSchd2(fn) {
  var lastArgs = [];
  var frameId = null;
  var wrapperFn = function wrapperFn2() {
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }
    lastArgs = args;
    if (frameId) {
      return;
    }
    frameId = requestAnimationFrame(function() {
      frameId = null;
      fn.apply(void 0, lastArgs);
    });
  };
  wrapperFn.cancel = function() {
    if (!frameId) {
      return;
    }
    cancelAnimationFrame(frameId);
    frameId = null;
  };
  return wrapperFn;
};
var raf_schd_esm_default = rafSchd;

// output/frontend-component-runtime/masonic/node_modules/masonic/dist/esm/index.mjs
function e(e2) {
  var t2 = e2.high;
  e2.L === O && e2.R === O ? e2.max = t2 : e2.L === O ? e2.max = Math.max(e2.R.max, t2) : e2.R === O ? e2.max = Math.max(e2.L.max, t2) : e2.max = Math.max(Math.max(e2.L.max, e2.R.max), t2);
}
function t(t2) {
  for (var r2 = t2; r2.P !== O; ) e(r2.P), r2 = r2.P;
}
function r(t2, r2) {
  if (r2.R !== O) {
    var i2 = r2.R;
    r2.R = i2.L, i2.L !== O && (i2.L.P = r2), i2.P = r2.P, r2.P === O ? t2.root = i2 : r2 === r2.P.L ? r2.P.L = i2 : r2.P.R = i2, i2.L = r2, r2.P = i2, e(r2), e(i2);
  }
}
function i(t2, r2) {
  if (r2.L !== O) {
    var i2 = r2.L;
    r2.L = i2.R, i2.R !== O && (i2.R.P = r2), i2.P = r2.P, r2.P === O ? t2.root = i2 : r2 === r2.P.R ? r2.P.R = i2 : r2.P.L = i2, i2.R = r2, r2.P = i2, e(r2), e(i2);
  }
}
function o(e2, t2, r2) {
  t2.P === O ? e2.root = r2 : t2 === t2.P.L ? t2.P.L = r2 : t2.P.R = r2, r2.P = t2.P;
}
function n() {
  var n2 = { root: O, size: 0 }, a2 = {};
  return { insert(o2, s2, l2) {
    for (var u3 = n2.root, f2 = O; u3 !== O && o2 !== (f2 = u3).low; ) u3 = o2 < u3.low ? u3.L : u3.R;
    if (o2 === f2.low && f2 !== O) {
      if (!(function(e2, t2, r2) {
        for (var i2, o3 = e2.list; o3; ) {
          if (o3.index === r2) return 0;
          if (t2 > o3.high) break;
          i2 = o3, o3 = o3.next;
        }
        return i2 || (e2.list = { index: r2, high: t2, next: o3 }), i2 && (i2.next = { index: r2, high: t2, next: i2.next }), 1;
      })(f2, s2, l2)) return;
      return f2.high = Math.max(f2.high, s2), e(f2), t(f2), a2[l2] = f2, void n2.size++;
    }
    var h2 = { low: o2, high: s2, max: s2, C: 0, P: f2, L: O, R: O, list: { index: l2, high: s2, next: null } };
    f2 === O ? n2.root = h2 : (h2.low < f2.low ? f2.L = h2 : f2.R = h2, t(h2)), (function(e2, t2) {
      for (var o3; 0 === t2.P.C; ) t2.P === t2.P.P.L ? 0 === (o3 = t2.P.P.R).C ? (t2.P.C = 1, o3.C = 1, t2.P.P.C = 0, t2 = t2.P.P) : (t2 === t2.P.R && r(e2, t2 = t2.P), t2.P.C = 1, t2.P.P.C = 0, i(e2, t2.P.P)) : 0 === (o3 = t2.P.P.L).C ? (t2.P.C = 1, o3.C = 1, t2.P.P.C = 0, t2 = t2.P.P) : (t2 === t2.P.L && i(e2, t2 = t2.P), t2.P.C = 1, t2.P.P.C = 0, r(e2, t2.P.P));
      e2.root.C = 1;
    })(n2, h2), a2[l2] = h2, n2.size++;
  }, remove(s2) {
    var l2 = a2[s2];
    if (void 0 !== l2) {
      delete a2[s2];
      var u3 = (function(e2, t2) {
        var r2 = e2.list;
        if (r2.index === t2) return null === r2.next ? 0 : (e2.list = r2.next, 1);
        var i2 = r2;
        for (r2 = r2.next; null !== r2; ) {
          if (r2.index === t2) return i2.next = r2.next, 1;
          i2 = r2, r2 = r2.next;
        }
      })(l2, s2);
      if (void 0 !== u3) {
        if (1 === u3) return l2.high = l2.list.high, e(l2), t(l2), void n2.size--;
        var f2, h2 = l2, v2 = h2.C;
        l2.L === O ? (f2 = l2.R, o(n2, l2, l2.R)) : l2.R === O ? (f2 = l2.L, o(n2, l2, l2.L)) : (v2 = (h2 = (function(e2) {
          for (; e2.L !== O; ) e2 = e2.L;
          return e2;
        })(l2.R)).C, f2 = h2.R, h2.P === l2 ? f2.P = h2 : (o(n2, h2, h2.R), h2.R = l2.R, h2.R.P = h2), o(n2, l2, h2), h2.L = l2.L, h2.L.P = h2, h2.C = l2.C), e(f2), t(f2), 1 === v2 && (function(e2, t2) {
          for (var o2; t2 !== O && 1 === t2.C; ) t2 === t2.P.L ? (0 === (o2 = t2.P.R).C && (o2.C = 1, t2.P.C = 0, r(e2, t2.P), o2 = t2.P.R), 1 === o2.L.C && 1 === o2.R.C ? (o2.C = 0, t2 = t2.P) : (1 === o2.R.C && (o2.L.C = 1, o2.C = 0, i(e2, o2), o2 = t2.P.R), o2.C = t2.P.C, t2.P.C = 1, o2.R.C = 1, r(e2, t2.P), t2 = e2.root)) : (0 === (o2 = t2.P.L).C && (o2.C = 1, t2.P.C = 0, i(e2, t2.P), o2 = t2.P.L), 1 === o2.R.C && 1 === o2.L.C ? (o2.C = 0, t2 = t2.P) : (1 === o2.L.C && (o2.R.C = 1, o2.C = 0, r(e2, o2), o2 = t2.P.L), o2.C = t2.P.C, t2.P.C = 1, o2.L.C = 1, i(e2, t2.P), t2 = e2.root));
          t2.C = 1;
        })(n2, f2), n2.size--;
      }
    }
  }, search(e2, t2, r2) {
    for (var i2 = [n2.root]; 0 !== i2.length; ) {
      var o2 = i2.pop();
      if (o2 !== O && e2 <= o2.max && (o2.L !== O && i2.push(o2.L), o2.R !== O && i2.push(o2.R), o2.low <= t2 && o2.high >= e2)) for (var a3 = o2.list; null !== a3; ) a3.high < e2 || r2(a3.index, o2.low), a3 = a3.next;
    }
  }, get size() {
    return n2.size;
  } };
}
function a() {
  return (a = Object.assign || function(e2) {
    for (var t2 = 1; arguments.length > t2; t2++) {
      var r2 = arguments[t2];
      for (var i2 in r2) Object.prototype.hasOwnProperty.call(r2, i2) && (e2[i2] = r2[i2]);
    }
    return e2;
  }).apply(this, arguments);
}
function s() {
  var e2 = C.useState(S)[1];
  return C.useRef(() => e2({})).current;
}
function l(e2) {
  var t2, { positioner: r2, resizeObserver: i2, items: o2, as: n2 = "div", id: a2, className: l2, style: f2, role: h2 = "grid", tabIndex: v2 = 0, containerRef: c2, itemAs: d2 = "div", itemStyle: m2, itemHeightEstimate: p3 = 300, itemKey: g2 = u2, overscanBy: P2 = 2, scrollTop: x2, isScrolling: R, height: y, render: w, onRender: M } = e2, b = 0, z = s(), T = F(r2, i2), k = o2.length, { columnWidth: I, columnCount: E, range: W, estimateHeight: O2, size: H2, shortestColumn: S2 } = r2, N2 = H2(), D2 = S2(), J2 = [], Q2 = "list" === h2 ? "listitem" : "grid" === h2 ? "gridcell" : void 0, U2 = module_default(M), V2 = x2 + (P2 *= y), X2 = V2 > D2 && k > N2;
  if (W(Math.max(0, x2 - P2 / 2), V2, (e3, r3, i3) => {
    var n3 = o2[e3], a3 = g2(n3, e3), s2 = { top: i3, left: r3, width: I, writingMode: "horizontal-tb", position: "absolute" };
    J2.push(j(d2, { key: a3, ref: T(e3), role: Q2, style: "object" == typeof m2 && null !== m2 ? Object.assign({}, s2, m2) : s2 }, B(w, e3, n3, I))), void 0 === t2 ? (b = e3, t2 = e3) : (b = Math.min(b, e3), t2 = Math.max(t2, e3));
  }), X2) for (var Y2 = Math.min(k - N2, Math.ceil((x2 + P2 - D2) / p3 * E)), Z2 = N2, $2 = q(I); N2 + Y2 > Z2; Z2++) {
    var _2 = o2[Z2], ee2 = g2(_2, Z2);
    J2.push(j(d2, { key: ee2, ref: T(Z2), role: Q2, style: "object" == typeof m2 ? Object.assign({}, $2, m2) : $2 }, B(w, Z2, _2, I)));
  }
  C.useEffect(() => {
    "function" == typeof U2.current && void 0 !== t2 && U2.current(b, t2, o2), A = "1";
  }, [b, t2, o2, U2]), C.useEffect(() => {
    X2 && z();
  }, [X2, r2]);
  var te = G(R, O2(k, p3));
  return j(n2, { ref: c2, key: A, id: a2, role: h2, className: l2, tabIndex: v2, style: "object" == typeof f2 ? K(te, f2) : te, children: J2 });
}
function u2(e2, t2) {
  return t2;
}
function f(e2, t2) {
  void 0 === e2 && (e2 = 0), void 0 === t2 && (t2 = 12);
  var r2 = module_default6(t2), [i2, o2] = C.useState(0), n2 = C.useRef(0);
  return C.useEffect(() => {
    1 === n2.current && o2(1);
    var e3 = 0, r3 = requestTimeout(() => {
      e3 || o2(0);
    }, 40 + 1e3 / t2);
    return n2.current = 1, () => {
      e3 = 1, clearRequestTimeout(r3);
    };
  }, [t2, r2]), { scrollTop: Math.max(0, r2 - e2), isScrolling: i2 };
}
function h(e2) {
  var { scrollTop: t2, isScrolling: r2 } = f(e2.offset, e2.scrollFps);
  return l({ scrollTop: t2, isScrolling: r2, positioner: e2.positioner, resizeObserver: e2.resizeObserver, items: e2.items, onRender: e2.onRender, as: e2.as, id: e2.id, className: e2.className, style: e2.style, role: e2.role, tabIndex: e2.tabIndex, containerRef: e2.containerRef, itemAs: e2.itemAs, itemStyle: e2.itemStyle, itemHeightEstimate: e2.itemHeightEstimate, itemKey: e2.itemKey, overscanBy: e2.overscanBy, height: e2.height, render: e2.render });
}
function v(e2, t2) {
  void 0 === t2 && (t2 = D);
  var [r2, i2] = C.useState({ offset: 0, width: 0 });
  return module_default7(() => {
    var { current: t3 } = e2;
    if (null !== t3) {
      var o2 = 0, n2 = t3;
      do {
        o2 += n2.offsetTop || 0, n2 = n2.offsetParent;
      } while (n2);
      o2 === r2.offset && t3.offsetWidth === r2.width || i2({ offset: o2, width: t3.offsetWidth });
    }
  }, t2), r2;
}
function c(e2, t2) {
  var { width: r2, columnWidth: i2 = 200, columnGutter: o2 = 0, rowGutter: n2, columnCount: a2, maxColumnCount: s2, maxColumnWidth: l2 } = e2;
  void 0 === t2 && (t2 = V);
  var u3 = () => {
    var [e3, t3] = U(r2, i2, o2, a2, s2, l2);
    return J(t3, e3, o2, null != n2 ? n2 : o2);
  }, f2 = C.useRef();
  void 0 === f2.current && (f2.current = u3());
  var h2 = C.useRef(t2), v2 = [r2, i2, o2, n2, a2, s2, l2], c2 = C.useRef(v2), d2 = !v2.every((e3, t3) => c2.current[t3] === e3);
  if (d2 || !t2.every((e3, t3) => h2.current[t3] === e3)) {
    var m2 = f2.current, p3 = u3();
    if (h2.current = t2, c2.current = v2, d2) for (var g2 = m2.size(), P2 = 0; g2 > P2; P2++) {
      var x2 = m2.get(P2);
      p3.set(P2, void 0 !== x2 ? x2.height : 0);
    }
    f2.current = p3;
  }
  return f2.current;
}
function d(e2) {
  function t2() {
    return i2.disconnect();
  }
  var r2 = s(), i2 = X(e2, r2);
  return C.useEffect(() => t2, [i2]), i2;
}
function m(e2) {
  e2.cancel();
}
function p2(e2, t2) {
  var r2, { align: i2 = "top", element: o2 = "undefined" != typeof window && window, offset: n2 = 0, height: a2 = "undefined" != typeof window ? window.innerHeight : 0 } = t2, s2 = module_default({ positioner: e2, element: o2, align: i2, offset: n2, height: a2 }), l2 = C.useRef(() => {
    var e3 = s2.current.element;
    return e3 && "current" in e3 ? e3.current : e3;
  }).current, [u3, f2] = C.useReducer((e3, t3) => {
    var r3, i3 = { position: e3.position, index: e3.index, prevTop: e3.prevTop };
    if ("scrollToIndex" === t3.type) return { position: s2.current.positioner.get(null !== (r3 = t3.value) && void 0 !== r3 ? r3 : -1), index: t3.value, prevTop: void 0 };
    if ("setPosition" === t3.type) i3.position = t3.value;
    else if ("setPrevTop" === t3.type) i3.prevTop = t3.value;
    else if ("reset" === t3.type) return Y;
    return i3;
  }, Y), h2 = useThrottleCallback(f2, 15);
  module_default2(l2(), "scroll", () => {
    if (!u3.position && u3.index) {
      var e3 = s2.current.positioner.get(u3.index);
      e3 && f2({ type: "setPosition", value: e3 });
    }
  });
  var v2 = void 0 !== u3.index && (null === (r2 = s2.current.positioner.get(u3.index)) || void 0 === r2 ? void 0 : r2.top);
  return C.useEffect(() => {
    var e3 = l2();
    if (e3) {
      var { height: t3, align: r3, offset: i3, positioner: o3 } = s2.current;
      if (u3.position) {
        var n3 = u3.position.top;
        "bottom" === r3 ? n3 = n3 - t3 + u3.position.height : "center" === r3 && (n3 -= (t3 - u3.position.height) / 2), e3.scrollTo(0, Math.max(0, n3 += i3));
        var a3 = 0, v3 = setTimeout((function() {
          return !a3 && f2({ type: "reset" });
        }), 400);
        return function() {
          a3 = 1, clearTimeout(v3);
        };
      }
      if (void 0 !== u3.index) {
        var c2 = o3.shortestColumn() / o3.size() * u3.index;
        u3.prevTop && (c2 = Math.max(c2, u3.prevTop + t3)), e3.scrollTo(0, c2), h2({ type: "setPrevTop", value: c2 });
      }
    }
  }, [v2, u3, s2, l2, h2]), C.useRef((e3) => {
    f2({ type: "scrollToIndex", value: e3 });
  }).current;
}
function g(e2) {
  var t2 = C.useRef(null), r2 = useWindowSize({ initialWidth: e2.ssrWidth, initialHeight: e2.ssrHeight }), i2 = v(t2, r2), o2 = Object.assign({ offset: i2.offset, width: i2.width || r2[0], height: r2[1], containerRef: t2 }, e2);
  o2.positioner = c(o2), o2.resizeObserver = d(o2.positioner);
  var n2 = p2(o2.positioner, { height: o2.height, offset: i2.offset, align: "object" == typeof e2.scrollToIndex ? e2.scrollToIndex.align : void 0 }), a2 = e2.scrollToIndex && ("number" == typeof e2.scrollToIndex ? e2.scrollToIndex : e2.scrollToIndex.index);
  return C.useEffect(() => {
    void 0 !== a2 && n2(a2);
  }, [a2, n2]), Z(h, o2);
}
function P(e2) {
  return $(g, a({ role: "list", rowGutter: e2.rowGutter, columnCount: 1, columnWidth: 1 }, e2));
}
function x(e2, t2) {
  void 0 === t2 && (t2 = ee);
  var { isItemLoaded: r2, minimumBatchSize: i2 = 16, threshold: o2 = 16, totalItems: n2 = 9e9 } = t2, a2 = module_default(e2), s2 = module_default(r2);
  return C.useCallback((e3, t3, r3) => {
    for (var l2 = (function(e4, t4, r4, i3, o3, n3) {
      void 0 === e4 && (e4 = _), void 0 === t4 && (t4 = 16), void 0 === i3 && (i3 = 9e9);
      for (var a3, s3, l3 = [], u4 = o3; n3 >= u4; u4++) e4(u4, r4) ? void 0 !== a3 && void 0 !== s3 && (l3.push(a3, s3), a3 = s3 = void 0) : (s3 = u4, void 0 === a3 && (a3 = u4));
      if (void 0 !== a3 && void 0 !== s3) {
        var f2 = Math.min(Math.max(s3, a3 + t4 - 1), i3 - 1);
        for (u4 = s3 + 1; f2 >= u4 && !e4(u4, r4); u4++) s3 = u4;
        l3.push(a3, s3);
      }
      if (l3.length) for (var h2 = l3[0], v2 = l3[1]; t4 > v2 - h2 + 1 && h2 > 0; ) {
        var c2 = h2 - 1;
        if (e4(c2, r4)) break;
        l3[0] = h2 = c2;
      }
      return l3;
    })(s2.current, i2, r3, n2, Math.max(0, e3 - o2), Math.min(n2 - 1, (t3 || 0) + o2)), u3 = 0; u3 < l2.length - 1; ++u3) a2.current(l2[u3], l2[++u3], r3);
  }, [n2, i2, o2, a2, s2]);
}
var O = { low: 0, max: 0, high: 0, C: 2, P: void 0, R: void 0, L: void 0, list: void 0 };
O.P = O, O.L = O, O.R = O;
var H = /* @__PURE__ */ new WeakMap();
var S = {};
var j = C.createElement;
var A = "0";
var B = module_default5([module_default4, {}, WeakMap, module_default4], (e2, t2, r2, i2) => j(e2, { index: t2, data: r2, width: i2 }));
var G = module_default3((e2, t2) => ({ position: "relative", width: "100%", maxWidth: "100%", height: Math.ceil(t2), maxHeight: Math.ceil(t2), willChange: e2 ? "contents" : void 0, pointerEvents: e2 ? "none" : void 0 }));
var N = (e2, t2) => e2[0] === t2[0] && e2[1] === t2[1];
var K = module_default3((e2, t2) => Object.assign({}, e2, t2), N);
var q = module_default3((e2) => ({ width: e2, zIndex: -1e3, visibility: "hidden", position: "absolute", writingMode: "horizontal-tb" }), (e2, t2) => e2[0] === t2[0]);
var F = module_default3((e2, t2) => (r2) => (i2) => {
  null !== i2 && (t2 && (t2.observe(i2), H.set(i2, r2)), void 0 === e2.get(r2) && e2.set(r2, i2.offsetHeight));
}, N);
var D = [];
var J = function(e2, t2, r2, i2) {
  void 0 === r2 && (r2 = 0), void 0 === i2 && (i2 = r2);
  for (var o2 = n(), a2 = new Array(e2), s2 = [], l2 = new Array(e2), u3 = 0; e2 > u3; u3++) a2[u3] = 0, l2[u3] = [];
  return { columnCount: e2, columnWidth: t2, set: function(e3, n2) {
    void 0 === n2 && (n2 = 0);
    for (var u4 = 0, f2 = 1; f2 < a2.length; f2++) a2[f2] < a2[u4] && (u4 = f2);
    var h2 = a2[u4] || 0;
    a2[u4] = h2 + n2 + i2, l2[u4].push(e3), s2[e3] = { left: u4 * (t2 + r2), top: h2, height: n2, column: u4 }, o2.insert(h2, h2 + n2, e3);
  }, get: (e3) => s2[e3], update: (t3) => {
    for (var r3 = new Array(e2), n2 = 0, u4 = 0; n2 < t3.length - 1; n2++) {
      var f2 = t3[n2], h2 = s2[f2];
      h2.height = t3[++n2], o2.remove(f2), o2.insert(h2.top, h2.top + h2.height, f2), r3[h2.column] = void 0 === r3[h2.column] ? f2 : Math.min(f2, r3[h2.column]);
    }
    for (n2 = 0; n2 < r3.length; n2++) if (void 0 !== r3[n2]) {
      var v2 = l2[n2], c2 = Q(v2, r3[n2]), d2 = l2[n2][c2], m2 = s2[d2];
      for (a2[n2] = m2.top + m2.height + i2, u4 = c2 + 1; u4 < v2.length; u4++) {
        var p3 = v2[u4], g2 = s2[p3];
        g2.top = a2[n2], a2[n2] = g2.top + g2.height + i2, o2.remove(p3), o2.insert(g2.top, g2.top + g2.height, p3);
      }
    }
  }, range: (e3, t3, r3) => o2.search(e3, t3, (e4, t4) => r3(e4, s2[e4].left, t4)), estimateHeight: (t3, r3) => {
    var i3 = Math.max(0, Math.max.apply(null, a2));
    return t3 === o2.size ? i3 : i3 + Math.ceil((t3 - o2.size) / e2) * r3;
  }, shortestColumn: () => a2.length > 1 ? Math.min.apply(null, a2) : a2[0] || 0, size: () => o2.size, all: () => s2 };
};
var Q = (e2, t2) => {
  for (var r2 = 0, i2 = e2.length - 1; i2 >= r2; ) {
    var o2 = r2 + i2 >>> 1, n2 = e2[o2];
    if (n2 === t2) return o2;
    n2 > t2 ? i2 = o2 - 1 : r2 = o2 + 1;
  }
  return -1;
};
var U = function(e2, t2, r2, i2, o2, n2) {
  void 0 === e2 && (e2 = 0), void 0 === t2 && (t2 = 0), void 0 === r2 && (r2 = 8), i2 = i2 || Math.min(Math.floor((e2 + r2) / (t2 + r2)), o2 || 1 / 0) || 1;
  var a2 = Math.floor((e2 - r2 * (i2 - 1)) / i2);
  return void 0 !== n2 && a2 > n2 && (a2 = n2), [a2, i2];
};
var V = [];
var X = module_default5([WeakMap], (e2, t2) => {
  var r2 = [], i2 = raf_schd_esm_default(() => {
    r2.length > 0 && (e2.update(r2), t2(r2)), r2.length = 0;
  }), o2 = (t3) => {
    var o3 = t3.offsetHeight;
    if (o3 > 0) {
      var n3 = H.get(t3);
      if (void 0 !== n3) {
        var a3 = e2.get(n3);
        void 0 !== a3 && o3 !== a3.height && r2.push(n3, o3);
      }
    }
    i2();
  }, n2 = /* @__PURE__ */ new Map(), a2 = new ResizeObserver((e3) => {
    for (var t3 = 0; t3 < e3.length; t3++) {
      var r3 = e3[t3], i3 = H.get(r3.target);
      if (void 0 !== i3) {
        var a3 = n2.get(i3);
        a3 || (a3 = raf_schd_esm_default(o2), n2.set(i3, a3)), a3(r3.target);
      }
    }
  }), s2 = a2.disconnect.bind(a2);
  return a2.disconnect = () => {
    s2(), n2.forEach(m);
  }, a2;
});
var Y = { index: void 0, position: void 0, prevTop: void 0 };
var Z = C.createElement;
var $ = C.createElement;
var _ = (e2, t2) => void 0 !== t2[e2];
var ee = {};
export {
  P as List,
  g as Masonry,
  h as MasonryScroller,
  n as createIntervalTree,
  J as createPositioner,
  X as createResizeObserver,
  v as useContainerPosition,
  x as useInfiniteLoader,
  l as useMasonry,
  c as usePositioner,
  d as useResizeObserver,
  p2 as useScrollToIndex,
  f as useScroller
};
