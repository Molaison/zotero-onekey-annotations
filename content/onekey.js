/* global Zotero, Components, setInterval, clearInterval, setTimeout, clearTimeout */
/* exported OneKeyPDFAnnotations */
var OneKeyPDFAnnotations = {
  // The order matches Zotero's ANNOTATION_COLORS in src/common/defines.js.
  COLORS: Object.freeze([
    ['General note', '#ffd400', 'KeyQ'],
    ['Intention', '#ff6666', 'KeyW'],
    ['Method they use', '#5fb236', 'KeyE'],
    ['Results', '#2ea8e5', 'KeyR'],
    ['Inference', '#a28ae5', 'KeyT'],
    ['Jargon', '#e56eee', 'KeyY'],
    ['Explanation', '#f19837', 'KeyG'],
    ['Limitation', '#aaaaaa', 'KeyF'],
  ]),
  NOTE_KEYS: Object.freeze(['KeyZ', 'KeyX', 'KeyC', 'KeyV']),
  _id: null,
  _started: false,
  _listenerRegistered: false,
  _readerStates: new Map(),
  _windowStates: new Map(),
  _timer: null,
  _toolbarHandler: null,

  log(message) {
    try { Zotero.debug('[OneKeyPDFAnnotations] ' + message); } catch (_) {}
  },

  start(id) {
    if (!this._id) this._id = id;
    if (!this._listenerRegistered && Zotero.Reader?.registerEventListener) {
      this._toolbarHandler = event => this.syncReader(event.reader);
      try {
        Zotero.Reader.registerEventListener('renderToolbar', this._toolbarHandler, this._id);
        this._listenerRegistered = true;
      } catch (error) {
        this.log('Could not register toolbar hook yet: ' + error);
      }
    }
    this._started = true;
    try { for (const win of Zotero.getMainWindows()) this.addWindow(win); } catch (_) {}
    this.scanReaders();
    // Restored tabs and split panes can be created *after* the toolbar hook.
    // One timer is used for all readers; listeners are only installed once.
    if (!this._timer) this._timer = setInterval(() => this.scanReaders(), 1500);
  },

  stop() {
    this._started = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._listenerRegistered) {
      try { Zotero.Reader.unregisterEventListener('renderToolbar', this._toolbarHandler); }
      catch (error) { this.log('Unregister hook: ' + error); }
    }
    this._listenerRegistered = false;
    this._toolbarHandler = null;
    for (const reader of [...this._readerStates.keys()]) this.removeReader(reader);
    for (const win of [...this._windowStates.keys()]) this.removeWindow(win);
  },

  addWindow(win) {
    if (!win || this._windowStates.has(win) || typeof win.addEventListener !== 'function') return;
    const keydown = e => {
      // Only act in a selected PDF reader tab, not the Zotero library tab.
      let reader;
      try { reader = Zotero.Reader.getByTabID(win.Zotero_Tabs?.selectedID); } catch (_) {}
      if (reader && this.isPDF(reader)) this.handleKey(e, reader, null, 'chrome');
    };
    win.addEventListener('keydown', keydown, true);
    this._windowStates.set(win, { keydown });
  },

  removeWindow(win) {
    const state = this._windowStates.get(win);
    if (!state) return;
    try { win.removeEventListener('keydown', state.keydown, true); } catch (_) {}
    this._windowStates.delete(win);
  },

  scanReaders() {
    if (!this._started) return;
    try {
      const found = new Set();
      const all = Zotero.Reader?._readers;
      let enumerated = false;
      if (Array.isArray(all)) {
        enumerated = true;
        for (const reader of all) if (reader) found.add(reader);
      } else if (all && typeof all.values === 'function') {
        enumerated = true;
        for (const reader of all.values()) if (reader) found.add(reader);
      }
      for (const win of this._windowStates.keys()) {
        try {
          const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs?.selectedID);
          if (reader) found.add(reader);
        } catch (_) {}
      }
      for (const reader of found) this.syncReader(reader);
      // Only prune when Zotero has provided an authoritative reader collection.
      // Readers in floating windows also occur in that collection.
      if (enumerated) {
        for (const reader of this._readerStates.keys()) {
          if (!found.has(reader)) this.removeReader(reader);
        }
      }
    } catch (error) {
      this.log('Reader scan failed: ' + error);
    }
  },

  isPDF(reader) {
    try { return (reader?.type || reader?._internalReader?._type) === 'pdf'; }
    catch (_) { return false; }
  },

  syncReader(reader) {
    if (!reader || !this.isPDF(reader)) return;
    let state = this._readerStates.get(reader);
    if (!state) {
      state = { windows: new Map(), patches: new Map(), status: null, statusTimer: null };
      this._readerStates.set(reader, state);
    }
    const outer = reader._iframeWindow;
    if (outer) this._addReaderWindow(reader, state, outer, 'outer');
    const ir = reader._internalReader;
    for (const view of [ir?._primaryView, ir?._secondaryView]) {
      if (!view) continue;
      if (view._iframeWindow) this._addReaderWindow(reader, state, view._iframeWindow, 'pdf');
      this._patchForwarder(reader, state, view);
    }
    // A split-view refresh may replace the inner iframe or view object.
    const live = new Set([outer, ir?._primaryView?._iframeWindow, ir?._secondaryView?._iframeWindow]);
    for (const [win, info] of state.windows) {
      if (!live.has(win)) {
        this._removeFrameListeners(win, info);
        state.windows.delete(win);
      }
    }
    const liveViews = new Set([ir?._primaryView, ir?._secondaryView].filter(Boolean).map(v => this._unwrap(v)));
    for (const [view, patch] of state.patches) {
      if (!liveViews.has(view)) {
        this._unpatch(view, patch);
        state.patches.delete(view);
      }
    }
  },

  removeReader(reader) {
    const state = this._readerStates.get(reader);
    if (!state) return;
    for (const [win, info] of state.windows) {
      this._removeFrameListeners(win, info);
    }
    for (const [view, patch] of state.patches) this._unpatch(view, patch);
    if (state.statusTimer) clearTimeout(state.statusTimer);
    try { state.status?.remove(); } catch (_) {}
    this._readerStates.delete(reader);
  },

  _addReaderWindow(reader, state, win, kind) {
    if (state.windows.has(win)) return;
    const info = { kind, composing: false };
    const keydown = event => this.handleKey(event, reader, kind === 'pdf' ? win : null, kind);
    // isComposing is not reliable on all IME keydown/keyup boundaries.
    // A composition event gives us a second, independent safeguard.
    info.keydown = keydown;
    info.compositionstart = () => { info.composing = true; };
    info.compositionend = () => { info.composing = false; };
    win.addEventListener('compositionstart', info.compositionstart, true);
    win.addEventListener('compositionend', info.compositionend, true);
    win.addEventListener('keydown', keydown, true);
    state.windows.set(win, info);
  },

  _removeFrameListeners(win, info) {
    try { win.removeEventListener('keydown', info.keydown, true); } catch (_) {}
    try { win.removeEventListener('compositionstart', info.compositionstart, true); } catch (_) {}
    try { win.removeEventListener('compositionend', info.compositionend, true); } catch (_) {}
  },

  _unwrap(value) {
    try { return Components.utils.unwrap(value); } catch (_) { return value; }
  },

  _patchForwarder(reader, state, wrappedView) {
    // Zotero forwards keydown from the inner PDF.js iframe by calling
    // view._onKeyDown(event), NOT by dispatching a DOM event to reader.html.
    // Without this patch, R can also trigger Zotero's Read Aloud shortcut.
    const view = this._unwrap(wrappedView);
    if (state.patches.has(view) || typeof view?._onKeyDown !== 'function') return;
    const original = view._onKeyDown;
    const self = this;
    const wrapper = function(event) {
      try {
        if (self.getAction(event, reader, view._iframeWindow, 'pdf')) return;
      } catch (_) {}
      return original.call(view, event);
    };
    try {
      const exported = Components.utils.exportFunction(wrapper, view);
      view._onKeyDown = exported;
      state.patches.set(view, { original, exported });
    } catch (error) {
      // Still work in the PDF iframe; native R read-aloud may also fire.
      this.log('Cannot patch reader key forwarding: ' + error);
    }
  },

  _unpatch(view, patch) {
    try {
      if (view._onKeyDown === patch.exported) view._onKeyDown = patch.original;
    } catch (_) {}
  },

  _targetIsEditable(target) {
    try {
      if (!target) return false;
      if (target.nodeType === 3) target = target.parentElement;
      if (!target) return false;
      const name = String(target.localName || target.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(name)) return true;
      if (target.isContentEditable) return true;
      if (typeof target.closest === 'function') {
        return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], .ProseMirror, .CodeMirror, .cm-editor, .editable-text');
      }
    } catch (_) {}
    return false;
  },

  _targetIsInteractive(target) {
    if (this._targetIsEditable(target)) return true;
    if (!target || target.nodeType !== 1) return false;
    const name = String(target.localName || target.tagName || '').toLowerCase();
    if (['button', 'a', 'summary', 'option'].includes(name)) return true;
    try {
      return !!target.closest('button, a, summary, option, [role="button"], [role="link"], '
        + '[role="tab"], [role="menuitem"], [role="option"], [role="combobox"], '
        + '[role="slider"], [role="checkbox"], [role="radio"], '
        + '[aria-haspopup="true"]');
    } catch (_) { return false; }
  },

  _chromeReaderFocused(event, reader) {
    // A selected PDF tab is not sufficient. Zotero's sidebar, tree and
    // toolbar still accept keyboard navigation while that tab is selected.
    // Chrome keys are a recovery path for a focused reader iframe, not a
    // window-wide keyboard hijack.
    const frame = reader?._iframe;
    if (!frame) return false;
    try {
      const active = reader._window?.document?.activeElement
        || event.target?.ownerDocument?.activeElement;
      return event.target === frame || active === frame;
    } catch (_) { return false; }
  },

  _isEditing(event, reader, sourceWindow) {
    if (this._targetIsInteractive(event?.target)) return true;
    // Composed paths include edit controls in shadow roots.
    try {
      if (event?.composedPath?.().some(x => this._targetIsInteractive(x))) return true;
    } catch (_) {}
    try {
      if (this._targetIsInteractive(sourceWindow?.document?.activeElement)) return true;
    } catch (_) {}
    try {
      if (this._targetIsInteractive(reader?._iframeWindow?.document?.activeElement)) return true;
    } catch (_) {}
    return false;
  },

  getAction(event, reader, pdfWin, sourceKind) {
    if (!this.isPDF(reader) || !event || !event.code) return null;
    // Only Alt+H / Alt+S are intentional modified shortcuts. Preserve every
    // other system/Zotero combination, including Ctrl/Alt/Shift/Meta mixes.
    if (event.ctrlKey || event.metaKey || event.shiftKey) return null;
    if (event.isComposing) return null;
    if (sourceKind === 'chrome' && !this._chromeReaderFocused(event, reader)) return null;
    const state = this._readerStates.get(reader);
    const activeWindow = sourceKind === 'pdf' ? pdfWin : reader._iframeWindow;
    if (state?.windows?.get(activeWindow)?.composing) return null;
    // event.key may be "Process" / "Unidentified" under Microsoft Pinyin;
    // event.code is the physical key. In the non-editable PDF viewport there
    // is no active text composition, so we can still handle that physical key.
    const sourceWindow = activeWindow;
    if (this._isEditing(event, reader, sourceWindow)) return null;
    const ir = reader._internalReader;
    // Visibility is a purely visual setting and also works in read-only PDFs.
    if (event.altKey) {
      if (event.code === 'KeyH') return { type: 'hideAnnotations', label: 'Hide all annotations' };
      if (event.code === 'KeyS') return { type: 'showAnnotations', label: 'Show all annotations' };
      return null;
    }
    if (ir?._state?.readOnly) return null;
    if (event.code === 'KeyD') {
      // Never delete anything without a *current* selection. In particular,
      // don't interpret D as "delete last annotation" or "delete all".
      const ids = ir?._state?.selectedAnnotationIDs;
      if (!Array.isArray(ids) || ids.length === 0) return null;
      return { type: 'delete', label: 'Delete selected annotations' };
    }
    const idx = this.COLORS.findIndex(row => row[2] === event.code);
    if (idx >= 0) return { type: 'highlight', color: this.COLORS[idx][1], label: this.COLORS[idx][0] };
    const noteIdx = this.NOTE_KEYS.indexOf(event.code);
    if (noteIdx >= 0) return { type: 'note', color: this.COLORS[noteIdx][1], label: 'Note ' + (noteIdx + 1) };
    if (event.code === 'KeyM') return { type: 'image', color: null, label: 'Rectangle / Area' };
    return null;
  },

  handleKey(event, reader, pdfWin, sourceKind) {
    const action = this.getAction(event, reader, pdfWin, sourceKind);
    if (!action) return false;
    // Consume auto-repeat too, but execute only the initial press.
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    if (event.repeat) return true;
    const view = this.getView(reader, pdfWin);
    try {
      if (action.type === 'hideAnnotations' || action.type === 'showAnnotations') {
        const ir = reader._internalReader;
        if (typeof ir?.showAnnotations !== 'function') throw new Error('Zotero reader.showAnnotations unavailable');
        const visible = action.type === 'showAnnotations';
        ir.showAnnotations(visible);
        this.status(reader, visible ? 'All annotations shown' : 'All annotations hidden (not deleted)', '#aaaaaa');
      } else if (action.type === 'delete') {
        const ir = reader._internalReader;
        if (typeof ir?.deleteAnnotations !== 'function') throw new Error('Zotero reader.deleteAnnotations unavailable');
        // Zotero itself asks for confirmation when multiple annotations are selected.
        const ids = [...(ir._state?.selectedAnnotationIDs || [])];
        if (ids.length === 0) return true;
        const removed = ir.deleteAnnotations(Components.utils.cloneInto(ids, reader._iframeWindow));
        this.status(reader, removed ? `${removed} annotation(s) deleted` : 'Deletion cancelled / unavailable', removed ? '#ff6666' : '#aaaaaa');
      } else if (action.type === 'highlight' && view && this.createHighlightFromSelection(reader, view, action.color)) {
        this.status(reader, action.label + ' · highlight saved', action.color);
      } else {
        const color = action.color || reader._internalReader?._tools?.image?.color || this.COLORS[0][1];
        this.setTool(reader, action.type, color);
        this.status(reader, action.label + ' · ' + (action.type === 'highlight' ? 'select text' : action.type === 'note' ? 'click to place note' : 'drag a rectangle'), color);
      }
    } catch (error) {
      this.log('Key action failed: ' + error + (error.stack ? '\n' + error.stack : ''));
      this.status(reader, 'Action failed; see Zotero Error Console', '#ff6666');
    }
    return true;
  },

  getView(reader, preferredPdfWin) {
    const ir = reader?._internalReader;
    const views = [ir?._primaryView, ir?._secondaryView].filter(Boolean);
    if (preferredPdfWin) {
      const match = views.find(v => v._iframeWindow === preferredPdfWin);
      if (match) return match;
    }
    const selected = views.filter(v => {
      try { return v?._selectionRanges?.some(r => !r.collapsed); } catch (_) { return false; }
    });
    if (selected.length === 1) return selected[0];
    return ir?._lastView || views[0] || null;
  },

  getSelectionAnnotation(reader, view) {
    const ir = reader?._internalReader;
    try {
      // Use Zotero's own text-selection geometry, rather than estimating
      // rectangles from browser DOM text nodes (which fails on PDF line wraps).
      const ranges = view?._selectionRanges;
      if (ranges?.length && ranges.some(r => !r.collapsed)
          && typeof view._getAnnotationFromSelectionRanges === 'function') {
        const ann = view._getAnnotationFromSelectionRanges(ranges, 'highlight');
        if (ann?.position && ann?.sortIndex && ann?.text) return ann;
      }
    } catch (error) { this.log('Selection geometry: ' + error); }
    // Only consult the popup when the view does not expose selection ranges.
    // An empty ranges array means the selection was cleared: using a stale
    // popup would create the *same highlight twice* on consecutive keys.
    if (Array.isArray(view?._selectionRanges)) return null;
    // Zotero already computed this for the native selection popup.
    try {
      const isSecondary = view === ir?._secondaryView;
      const popup = ir?._state?.[isSecondary ? 'secondaryViewSelectionPopup' : 'primaryViewSelectionPopup'];
      if (popup?.annotation?.position && popup.annotation.sortIndex && popup.annotation.text) return popup.annotation;
    } catch (_) {}
    return null;
  },

  createHighlightFromSelection(reader, view, color) {
    const ann = this.getSelectionAnnotation(reader, view);
    if (!ann) return false;
    const ir = reader._internalReader;
    if (!ir?._annotationManager?.addAnnotation || !reader._iframeWindow) return false;
    // Crossing the privileged Zotero window -> reader content boundary requires
    // cloneInto. A JSON round trip also strips proxy/object prototypes.
    const plain = {
      type: 'highlight',
      color,
      sortIndex: String(ann.sortIndex),
      pageLabel: String(ann.pageLabel || ''),
      text: String(ann.text),
      comment: '',
      position: JSON.parse(JSON.stringify(ann.position)),
    };
    const data = Components.utils.cloneInto(plain, reader._iframeWindow);
    const created = ir._annotationManager.addAnnotation(data);
    if (!created) return false;
    // Clear the now-consumed selection just as Zotero's native annotation path does.
    try { view._setSelectionRanges?.(); } catch (_) {}
    try { view._iframeWindow?.getSelection?.()?.removeAllRanges?.(); } catch (_) {}
    return true;
  },

  setTool(reader, type, color) {
    const ir = reader?._internalReader;
    if (typeof ir?.setTool !== 'function') throw new Error('Zotero reader.setTool unavailable');
    // Zotero's Reader.setTool() (10.x) mutates the current tool in place and
    // _updateState compares by object identity. Two color changes on the SAME
    // tool can thus silently fail to update the PDF canvas. Switching through
    // the pointer tool first makes the reader issue a new tool state.
    const active = ir._state?.tool;
    if (active?.type === type && active.color !== color) {
      ir.setTool(Components.utils.cloneInto({ type: 'pointer' }, reader._iframeWindow));
    }
    ir.setTool(Components.utils.cloneInto({ type, color }, reader._iframeWindow));
  },

  status(reader, message, color) {
    try {
      const state = this._readerStates.get(reader);
      const doc = reader?._iframeWindow?.document;
      if (!state || !doc?.body) return;
      if (!state.status || !state.status.isConnected) {
        state.status = doc.createElement('div');
        state.status.setAttribute('aria-live', 'polite');
        state.status.style.cssText = 'position:fixed;bottom:24px;right:20px;z-index:2147483647;pointer-events:none;background:rgba(24,28,38,.93);color:#fff;border-radius:6px;font:12px/1.4 system-ui;padding:7px 10px;box-shadow:0 4px 18px rgba(0,0,0,.2);';
        doc.body.appendChild(state.status);
      }
      state.status.style.borderLeft = '4px solid ' + color;
      state.status.textContent = message;
      if (state.statusTimer) clearTimeout(state.statusTimer);
      state.statusTimer = setTimeout(() => {
        try { state.status?.remove(); } catch (_) {}
        state.status = null;
      }, 1000);
    } catch (_) {}
  },
};
