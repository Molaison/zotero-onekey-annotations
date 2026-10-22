const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const setCalls = [];
  const added = [];
  const deleted = [];
  const visibility = [];
  let originalForwarded = 0;
  let cleaned = 0;
  function documentWithStyles(activeTag) {
    const nodes = new Map();
    return {
      activeElement: { tagName: activeTag, nodeType: 1 },
      getElementById: id => nodes.get(id) || null,
      createElement: tag => ({ tagName: tag.toUpperCase(), remove() { nodes.delete(this.id); } }),
      head: { appendChild(node) { nodes.set(node.id, node); } },
    };
  }
  const pdfWin = {
    document: documentWithStyles('BODY'),
    addEventListener(type, handler) { (this.listeners ||= {})[type] = handler; if (type === 'keydown') this.listener = handler; },
    removeEventListener(type) { cleaned++; if (this.listeners) delete this.listeners[type]; },
    getSelection() { return { removeAllRanges() {} }; },
  };
  const outerWin = {
    document: documentWithStyles('IFRAME'),
    addEventListener(type, handler) { (this.listeners ||= {})[type] = handler; if (type === 'keydown') this.listener = handler; },
    removeEventListener(type) { cleaned++; if (this.listeners) delete this.listeners[type]; },
  };
  const view = {
    _iframeWindow: pdfWin,
    _selectionRanges: [],
    _onKeyDown() { originalForwarded++; },
    _getAnnotationFromSelectionRanges(ranges, type) {
      return { type, sortIndex: '00010|00010', pageLabel: '3', text: 'test selection', position: { pageIndex: 2, rects: [[1,2,3,4]] }};
    },
    _setSelectionRanges() { this._selectionRanges = []; },
  };
  const internal = {
    _type: 'pdf',
    _state: { readOnly: false, selectedAnnotationIDs: [], showAnnotations: true },
    _tools: { image: { color: '#ff6666' } },
    _primaryView: view,
    _annotationManager: { addAnnotation(annotation) { added.push(annotation); return { ...annotation, id: 'ABCD1234' }; } },
    setTool(obj) { setCalls.push(obj); },
    deleteAnnotations(ids) { deleted.push([...ids]); this._state.selectedAnnotationIDs = []; return ids.length; },
    // Zotero's PDFView lacks setShowAnnotations; the reader-level method is
    // not a supported route for PDF and would fail at runtime.
    showAnnotations() { throw new Error('PDFView.setShowAnnotations is not a function'); },
  };
  const reader = { type: 'pdf', _internalReader: internal, _iframeWindow: outerWin, _instanceID: 'reader1' };
  const hookNames = [];
  const Zotero = {
    Reader: {
      _readers: [reader],
      registerEventListener: (type, cb, id) => hookNames.push({ type, id }),
      unregisterEventListener: (type, cb) => hookNames.push({ unregister: type }),
    },
    getMainWindows() { return []; },
    debug() {},
  };
  const C = {
    utils: {
      unwrap: x => x,
      exportFunction: f => f,
      cloneInto: x => JSON.parse(JSON.stringify(x)),
    },
  };
  const context = vm.createContext({ Zotero, Components: C, setInterval: () => 99, clearInterval() {}, setTimeout: () => 100, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/onekey.js'), 'utf8'), context);
  const api = context.OneKeyPDFAnnotations;
  function event(code, props = {}) {
    let prevented = 0; let stopped = 0;
    const ev = {
      code,
      key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code,
      target: { tagName: 'DIV', nodeType: 1 },
      preventDefault() { prevented++; },
      stopImmediatePropagation() { stopped++; },
      stopPropagation() {},
      get prevented() { return prevented; },
      get stopped() { return stopped; },
      ...props,
    };
    return ev;
  }
  return { api, Zotero, reader, internal, view, outerWin, pdfWin, setCalls, added, deleted, visibility, event, hookNames, documentWithStyles, countForwarded: () => originalForwarded, countCleaned: () => cleaned };
}

test('8 physical-letter codes map exactly to Zotero default color order', () => {
  const f = setup();
  const keys = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyG', 'KeyF'];
  const colors = ['#ffd400', '#ff6666', '#5fb236', '#2ea8e5', '#a28ae5', '#e56eee', '#f19837', '#aaaaaa'];
  for (let i = 0; i < keys.length; i++) {
    const e = f.event(keys[i], { key: 'Process' });
    const a = f.api.getAction(e, f.reader, f.pdfWin, 'pdf');
    assert.equal(a.type, 'highlight');
    assert.equal(a.color, colors[i]);
  }
});

test('Z/X/C/V choose first 4 note colors; M chooses Zotero rectangular area tool', () => {
  const f = setup();
  for (const [key, color] of [['KeyZ','#ffd400'], ['KeyX','#ff6666'], ['KeyC','#5fb236'], ['KeyV','#2ea8e5']]) {
    const e = f.event(key);
    assert.equal(f.api.handleKey(e, f.reader, f.pdfWin, 'pdf'), true);
    assert.equal(e.prevented, 1);
    assert.equal(f.setCalls.at(-1).type, 'note');
    assert.equal(f.setCalls.at(-1).color, color);
  }
  f.api.handleKey(f.event('KeyM'), f.reader, f.pdfWin, 'pdf');
  assert.equal(f.setCalls.at(-1).type, 'image');
  assert.equal(f.setCalls.at(-1).color, '#ff6666');
});

test('selected text + color key saves highlight without tool switch or duplicate', () => {
  const f = setup();
  f.view._selectionRanges = [{ collapsed: false, position: { pageIndex: 2 } }];
  const e = f.event('KeyG');
  assert.equal(f.api.handleKey(e, f.reader, f.pdfWin, 'pdf'), true);
  assert.equal(f.setCalls.length, 0);
  assert.equal(f.added.length, 1);
  assert.equal(f.added[0].color, '#f19837');
  assert.equal(f.added[0].type, 'highlight');
  assert.equal(f.added[0].text, 'test selection');
  assert.equal(f.view._selectionRanges.length, 0);
  assert.equal(e.stopped, 1);
});

test('unselected text changes highlight tool, while repeat is swallowed once', () => {
  const f = setup();
  f.api.handleKey(f.event('KeyW'), f.reader, f.pdfWin, 'pdf');
  assert.equal(f.setCalls[0].type, 'highlight');
  assert.equal(f.setCalls[0].color, '#ff6666');
  const e = f.event('KeyW', { repeat: true });
  assert.equal(f.api.handleKey(e, f.reader, f.pdfWin, 'pdf'), true);
  assert.equal(e.prevented, 1);
  assert.equal(f.setCalls.length, 1);
});

test('typing, modifiers and live IME composition are never hijacked', () => {
  const f = setup();
  const cases = [
    {target: {tagName: 'INPUT'}},
    {target: {tagName: 'TEXTAREA'}},
    {target: {tagName: 'DIV', isContentEditable: true}},
    {target: {tagName: 'DIV', closest: css => css.includes('role') ? {role:'textbox'} : null}},
    {isComposing: true},
    {ctrlKey: true},
    {shiftKey: true},
    {altKey: true},
    {metaKey: true},
  ];
  for (const props of cases) {
    const e = f.event('KeyQ', props);
    assert.equal(f.api.handleKey(e, f.reader, f.pdfWin, 'pdf'), false, JSON.stringify(props));
    assert.equal(e.prevented, 0);
  }
  f.outerWin.document.activeElement = {tagName:'INPUT'};
  assert.equal(f.api.handleKey(f.event('KeyR'), f.reader, f.pdfWin, 'pdf'), false);
  f.outerWin.document.activeElement = {tagName:'IFRAME'};
  f.pdfWin.document.activeElement = {tagName:'INPUT'};
  assert.equal(f.api.handleKey(f.event('KeyM'), f.reader, f.pdfWin, 'pdf'), false);
  assert.equal(f.setCalls.length, 0);
});

test('read-only files and non-PDF readers remain untouched', () => {
  const f = setup();
  f.internal._state.readOnly = true;
  assert.equal(f.api.handleKey(f.event('KeyF'), f.reader, f.pdfWin, 'pdf'), false);
  f.internal._state.readOnly = false;
  f.reader.type = 'epub';
  assert.equal(f.api.handleKey(f.event('KeyQ'), f.reader, f.pdfWin, 'pdf'), false);
});

test('patched inner reader forwarding suppresses R default command, not other commands', () => {
  const f = setup();
  const original = f.view._onKeyDown;
  f.api.start('onekey-pdf-annotations@local.zotero');
  assert.equal(f.hookNames[0].type, 'renderToolbar');
  const r = f.event('KeyR');
  f.view._onKeyDown(r);
  assert.equal(f.countForwarded(), 0, 'R must not reach Zotero native Read Aloud');
  assert.equal(f.setCalls.length, 1, 'forwarded key must actually activate the highlight tool');
  assert.equal(f.setCalls[0].color, '#2ea8e5');
  assert.equal(r.prevented, 1);
  const normal = f.event('KeyA');
  f.view._onKeyDown(normal);
  assert.equal(f.countForwarded(), 1);
  const editing = f.event('KeyR', {target: {tagName:'INPUT'}});
  f.view._onKeyDown(editing);
  assert.equal(f.countForwarded(), 2, 'native reader retains input events');
  f.api.stop();
  assert.equal(f.hookNames.at(-1).unregister, 'renderToolbar');
  assert.equal(f.countCleaned(), 6, 'remove keydown and both IME listeners from outer and inner frames');
  assert.equal(f.view._onKeyDown, original, 'original native forwarder restored on shutdown');
});

test('split view and recreated iframe get listeners without doubling handlers', () => {
  const f = setup();
  f.api.start('onekey-pdf-annotations@local.zotero');
  const originalListener = f.pdfWin.listener;
  f.api.scanReaders();
  assert.equal(f.pdfWin.listener, originalListener);
  const secondaryWindow = { addEventListener(t,cb) { this.listener=cb; }, removeEventListener() {} };
  const secondaryView = { _iframeWindow: secondaryWindow, _onKeyDown() {} };
  f.internal._secondaryView = secondaryView;
  f.api.scanReaders();
  assert.equal(typeof secondaryWindow.listener, 'function');
  f.api.stop();
});

test('Zotero install manifest supplies all three required application fields', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.equal(data.manifest_version, 2);
  assert.equal(data.applications.zotero.id, 'onekey-pdf-annotations@local.zotero');
  assert.match(data.applications.zotero.update_url, /^https:\/\//);
  assert.equal(data.applications.zotero.strict_max_version, '10.0.*');
});


test('switching among colors while highlight tool is already active propagates each change to PDF canvas', () => {
  // Reproduces Zotero 10 reader.setTool(): mutate current tool in place, then
  // _updateState() only calls the view when state.tool identity changes.
  // A naive setTool({type:'highlight',color}) fails here after the first key.
  const f = setup();
  const ir = f.internal;
  ir._tools = {
    pointer: {type:'pointer'},
    highlight: {type:'highlight',color:'#ffd400'},
    note: {type:'note',color:'#ffd400'},
    image: {type:'image',color:'#ff6666'},
  };
  ir._state.tool = ir._tools.pointer;
  const viewUpdates = [];
  ir.setTool = function(params) {
    let tool = this._state.tool;
    const before = tool;
    if (params.type && tool.type !== params.type) tool = this._tools[params.type];
    Object.assign(tool, params);
    this._state = {...this._state, tool};
    if (tool !== before) viewUpdates.push({type:tool.type, color:tool.color});
  };
  for (const [key,color] of [['KeyQ','#ffd400'], ['KeyR','#2ea8e5'], ['KeyE','#5fb236']]) {
    assert.equal(f.api.handleKey(f.event(key),f.reader,f.pdfWin,'pdf'),true);
    assert.deepEqual(viewUpdates.at(-1),{type:'highlight',color});
  }
  assert.equal(viewUpdates.filter(v=>v.type==='highlight').length,3);
  assert.equal(viewUpdates.filter(v=>v.type==='pointer').length,2);
});

test('sticky-note color switches update PDF canvas even within the same note tool', () => {
  const f=setup();
  const ir=f.internal;
  ir._tools={pointer:{type:'pointer'},note:{type:'note',color:'#ffd400'}};
  ir._state.tool=ir._tools.pointer;
  const updates=[];
  ir.setTool=function(params) {
    let tool=this._state.tool;const previous=tool;
    if(params.type && tool.type!==params.type)tool=this._tools[params.type];
    Object.assign(tool,params);this._state={...this._state,tool};
    if(previous!==tool)updates.push({type:tool.type,color:tool.color});
  };
  f.api.handleKey(f.event('KeyZ'),f.reader,f.pdfWin,'pdf');
  f.api.handleKey(f.event('KeyX'),f.reader,f.pdfWin,'pdf');
  assert.equal(updates.at(-1).color,'#ff6666');
  assert.equal(updates.at(-1).type,'note');
});

test('stale selection popup cannot produce duplicate highlight after selection was consumed', () => {
  const f=setup();
  f.view._selectionRanges=[{collapsed:false,position:{pageIndex:2}}];
  // Simulate async popup state, which might lag behind selection cleanup.
  f.internal._state.primaryViewSelectionPopup={annotation: f.view._getAnnotationFromSelectionRanges([],'highlight')};
  f.api.handleKey(f.event('KeyQ'),f.reader,f.pdfWin,'pdf');
  assert.equal(f.added.length,1);
  assert.equal(f.view._selectionRanges.length,0);
  f.api.handleKey(f.event('KeyW'),f.reader,f.pdfWin,'pdf');
  assert.equal(f.added.length,1, 'a second key must select tool, not reannotate stale popup');
  assert.equal(f.setCalls.at(-1).color,'#ff6666');
});

test('compositionstart blocks bare physical-key shortcuts even when isComposing is false', () => {
  const f=setup();
  f.api.start('onekey-pdf-annotations@local.zotero');
  f.pdfWin.listeners.compositionstart();
  const mid=f.event('KeyQ',{isComposing:false,key:'Process'});
  assert.equal(f.api.handleKey(mid,f.reader,f.pdfWin,'pdf'),false);
  assert.equal(f.setCalls.length,0);
  f.pdfWin.listeners.compositionend();
  const after=f.event('KeyQ',{isComposing:false,key:'Process'});
  assert.equal(f.api.handleKey(after,f.reader,f.pdfWin,'pdf'),true);
  assert.equal(f.setCalls.at(-1).color,'#ffd400');
  f.api.stop();
});

test('focused toolbar and interactive buttons do not trigger annotation actions', () => {
  const f=setup();
  const controls=[
    {tagName:'BUTTON',nodeType:1},
    {tagName:'A',nodeType:1},
    {tagName:'DIV',nodeType:1,closest:() => ({})},
  ];
  for(const target of controls){
    const ev=f.event('KeyR',{target});
    assert.equal(f.api.handleKey(ev,f.reader,f.pdfWin,'pdf'),false);
    assert.equal(ev.prevented,0);
  }
  assert.equal(f.setCalls.length,0);
});

test('main-window shortcut guard activates only if the reader iframe has focus', () => {
  const f=setup();
  const frame={tagName:'IFRAME'};
  const panel={tagName:'DIV'};
  const mainDocument={activeElement:panel};
  const mainWindow={document:mainDocument};
  f.reader._iframe=frame;
  f.reader._window=mainWindow;
  const ev=f.event('KeyR',{target:panel});
  assert.equal(f.api.handleKey(ev,f.reader,null,'chrome'),false);
  assert.equal(f.setCalls.length,0);
  mainDocument.activeElement=frame;
  const ev2=f.event('KeyR',{target:frame});
  assert.equal(f.api.handleKey(ev2,f.reader,null,'chrome'),true);
  assert.equal(f.setCalls.at(-1).type,'highlight');
});

test('split-reader keydown uses the pane where shortcut was pressed', () => {
  const f=setup();
  f.view._selectionRanges=[{collapsed:false,position:{pageIndex:1}}];
  const view2={...f.view,_selectionRanges:[{collapsed:false,position:{pageIndex:9}}],
    _getAnnotationFromSelectionRanges(){return {type:'highlight',sortIndex:'9|9',pageLabel:'10',text:'secondary',position:{pageIndex:9,rects:[[3,4,5,6]]}};}};
  const win2={document:{activeElement:{tagName:'BODY'}}};
  view2._iframeWindow=win2;
  f.internal._secondaryView=view2;
  f.api.handleKey(f.event('KeyT'),f.reader,win2,'pdf');
  assert.equal(f.added.length,1);
  assert.equal(f.added[0].text,'secondary');
  assert.equal(f.added[0].position.pageIndex,9);
  assert.equal(f.view._selectionRanges.length,1);
  assert.equal(view2._selectionRanges.length,0);
});

test('recreated PDF iframe gets fresh listeners; stale iframe listeners are removed', () => {
  const f=setup();
  f.api.start('onekey-pdf-annotations@local.zotero');
  const win2={document:{activeElement:{tagName:'BODY'}},listeners:{},addEventListener(t,cb){this.listeners[t]=cb;},removeEventListener(t){delete this.listeners[t];}};
  f.view._iframeWindow=win2;
  f.api.scanReaders();
  assert.equal(typeof win2.listeners.keydown,'function');
  assert.equal(typeof win2.listeners.compositionstart,'function');
  assert.equal(typeof f.pdfWin.listeners.keydown,'undefined');
  f.api.stop();
  assert.equal(typeof win2.listeners.keydown,'undefined');
});


test('D deletes exactly the selected annotation through Zotero native deletion', () => {
  const f = setup();
  f.internal._state.selectedAnnotationIDs = ['ABCD1234'];
  const e = f.event('KeyD');
  assert.equal(f.api.handleKey(e, f.reader, f.pdfWin, 'pdf'), true);
  assert.equal(e.prevented, 1);
  assert.deepEqual(f.deleted, [['ABCD1234']]);
  assert.deepEqual(f.internal._state.selectedAnnotationIDs, []);
});

test('D with no selected annotation is not intercepted or destructive', () => {
  const f = setup();
  const e = f.event('KeyD');
  assert.equal(f.api.handleKey(e, f.reader, f.pdfWin, 'pdf'), false);
  assert.equal(e.prevented, 0);
  assert.equal(f.deleted.length, 0);
});

test('D with multiple selected annotations defers native confirmation to Zotero', () => {
  const f = setup();
  f.internal._state.selectedAnnotationIDs = ['A', 'B', 'C'];
  let confirmInvoked = 0;
  f.internal.deleteAnnotations = ids => { confirmInvoked++; assert.deepEqual([...ids], ['A', 'B', 'C']); return 0; };
  assert.equal(f.api.handleKey(f.event('KeyD'), f.reader, f.pdfWin, 'pdf'), true);
  assert.equal(confirmInvoked, 1);
  assert.deepEqual(f.internal._state.selectedAnnotationIDs, ['A', 'B', 'C']);
});

test('Alt+H hides all annotation overlays and Alt+S restores visibility', () => {
  const f = setup();
  for (const [code, expected] of [['KeyH', true], ['KeyS', false]]) {
    const e = f.event(code, {altKey: true});
    assert.equal(f.api.handleKey(e, f.reader, f.pdfWin, 'pdf'), true);
    assert.equal(e.prevented, 1);
    assert.equal(!!f.pdfWin.document.getElementById(f.api.HIDE_STYLE_ID), expected);
  }
  assert.equal(f.internal._state.showAnnotations, true);
  assert.deepEqual(f.deleted, []);
});

test('Alt+H/S work in read-only PDFs while D and editing commands do not', () => {
  const f = setup();
  f.internal._state.readOnly = true;
  f.internal._state.selectedAnnotationIDs = ['A'];
  assert.equal(f.api.handleKey(f.event('KeyD'), f.reader, f.pdfWin, 'pdf'), false);
  assert.equal(f.api.handleKey(f.event('KeyR'), f.reader, f.pdfWin, 'pdf'), false);
  assert.equal(f.api.handleKey(f.event('KeyH',{altKey:true}), f.reader, f.pdfWin, 'pdf'), true);
  assert.ok(f.pdfWin.document.getElementById(f.api.HIDE_STYLE_ID));
  assert.equal(f.api.handleKey(f.event('KeyS',{altKey:true}), f.reader, f.pdfWin, 'pdf'), true);
  assert.equal(f.pdfWin.document.getElementById(f.api.HIDE_STYLE_ID), null);
  assert.deepEqual(f.deleted, []);
});

test('Alt+H/S never hijack inputs, IME composition, or compound modifiers', () => {
  const f = setup();
  const cases = [
    {code:'KeyH',props:{altKey:true,target:{tagName:'INPUT'}}},
    {code:'KeyS',props:{altKey:true,target:{tagName:'TEXTAREA'}}},
    {code:'KeyH',props:{altKey:true,isComposing:true}},
    {code:'KeyS',props:{altKey:true,ctrlKey:true}},
    {code:'KeyH',props:{altKey:true,metaKey:true}},
    {code:'KeyS',props:{altKey:true,shiftKey:true}},
    {code:'KeyJ',props:{altKey:true}},
    {code:'KeyD',props:{altKey:true}},
  ];
  f.internal._state.selectedAnnotationIDs = ['ABCD1234'];
  for(const {code,props} of cases) {
    const e = f.event(code,props);
    assert.equal(f.api.handleKey(e,f.reader,f.pdfWin,'pdf'),false,code);
    assert.equal(e.prevented,0);
  }
  assert.equal(f.pdfWin.document.getElementById(f.api.HIDE_STYLE_ID), null);
  assert.deepEqual(f.deleted, []);
});

test('PDF forwarding patches also suppress Zotero native handling of D/Alt+H/Alt+S', () => {
  const f = setup();
  f.internal._state.selectedAnnotationIDs = ['A'];
  f.api.start('onekey-pdf-annotations@local.zotero');
  for(const e of [f.event('KeyD'),f.event('KeyH',{altKey:true}),f.event('KeyS',{altKey:true})]){
    f.view._onKeyDown(e);
  }
  assert.equal(f.countForwarded(),0);
  assert.equal(f.view._onKeyDown(f.event('KeyA')), undefined);
  assert.equal(f.countForwarded(),1);
  f.api.stop();
});

test('Alt+S show-all works with physical key code even when IME key is Process', () => {
  const f=setup();
  f.api.handleKey(f.event('KeyH',{altKey:true}),f.reader,f.pdfWin,'pdf');
  const e=f.event('KeyS',{key:'Process',altKey:true});
  assert.equal(f.api.handleKey(e,f.reader,f.pdfWin,'pdf'),true);
  assert.equal(f.pdfWin.document.getElementById(f.api.HIDE_STYLE_ID),null);
});

test('hide persists across split pane and iframe recreation, and unload restores overlays', () => {
  const f = setup();
  f.api.start('onekey-pdf-annotations@local.zotero');
  f.api.handleKey(f.event('KeyH', {altKey:true}), f.reader, f.pdfWin, 'pdf');
  assert.ok(f.pdfWin.document.getElementById(f.api.HIDE_STYLE_ID));
  const win2 = { document:f.documentWithStyles('BODY'),
    addEventListener() {}, removeEventListener() {} };
  f.internal._secondaryView = { _iframeWindow:win2, _onKeyDown() {} };
  f.api.scanReaders();
  assert.ok(win2.document.getElementById(f.api.HIDE_STYLE_ID));
  const win3 = { document:f.documentWithStyles('BODY'),
    addEventListener() {}, removeEventListener() {} };
  f.view._iframeWindow = win3;
  f.api.scanReaders();
  assert.ok(win3.document.getElementById(f.api.HIDE_STYLE_ID));
  f.api.stop();
  assert.equal(win3.document.getElementById(f.api.HIDE_STYLE_ID),null);
  assert.equal(win2.document.getElementById(f.api.HIDE_STYLE_ID),null);
});

test('Reading Mode keydown is attached to SDT iframe and creates direct highlight from live selection', () => {
  const f = setup();
  let cleared = 0;
  const readingWin = { document:f.documentWithStyles('BODY'),
    addEventListener(type,handler) { (this.listeners ||= {})[type] = handler; },
    removeEventListener(type) { delete this.listeners[type]; },
    getSelection() { return {isCollapsed:false,rangeCount:1,removeAllRanges() {cleared++;}}; },
  };
  const sdt = {
    _iframeWindow:readingWin,
    _getAnnotationFromTextSelection(type,color) {
      return {type,color,sortIndex:'sdt-1',pageLabel:'5',text:'reading mode text',
        position:{pageIndex:4, rects:[[1,2,3,4]]}};
    },
    _finalizeAnnotation(a) { return a; },
    setShowAnnotations(val) { this._showAnnotations=val; },
    _showAnnotations:true,
  };
  f.internal._primarySDTView=sdt;
  f.internal._activePrimaryView=sdt;
  f.api.start('onekey-pdf-annotations@local.zotero');
  assert.equal(typeof readingWin.listeners.keydown,'function');
  readingWin.listeners.keydown(f.event('KeyR'));
  assert.equal(f.added.length,1);
  assert.equal(f.added[0].color,'#2ea8e5');
  assert.equal(f.added[0].text,'reading mode text');
  assert.equal(cleared,1);
  f.api.handleKey(f.event('KeyH',{altKey:true}),f.reader,readingWin,'pdf');
  assert.equal(sdt._showAnnotations,false);
  f.api.handleKey(f.event('KeyS',{altKey:true}),f.reader,readingWin,'pdf');
  assert.equal(sdt._showAnnotations,true);
  f.api.stop();
});

test('forwarder alone saves highlighted selection without any DOM listener callback', () => {
  const f=setup();
  f.api.start('onekey-pdf-annotations@local.zotero');
  f.view._selectionRanges=[{collapsed:false,position:{pageIndex:2}}];
  const key=f.event('KeyQ');
  f.view._onKeyDown(key);
  assert.equal(f.added.length,1);
  assert.equal(f.added[0].color,'#ffd400');
  assert.equal(f.countForwarded(),0);
  assert.equal(key.prevented,1);
  f.api.stop();
});
