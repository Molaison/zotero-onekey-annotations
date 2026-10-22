/* global Zotero, Services, OneKeyPDFAnnotations */
var OneKeyPDFAnnotations;

async function startup({ id, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + 'content/onekey.js');
  // Register before awaiting startup; Zotero can restore reader tabs during startup.
  OneKeyPDFAnnotations.start(id);
  await Zotero.initializationPromise;
  OneKeyPDFAnnotations.start(id); // Idempotent, retries early registration if needed.
}

function onMainWindowLoad({ window }) {
  OneKeyPDFAnnotations?.addWindow(window);
}

function onMainWindowUnload({ window }) {
  OneKeyPDFAnnotations?.removeWindow(window);
}

function shutdown() {
  OneKeyPDFAnnotations?.stop();
  OneKeyPDFAnnotations = undefined;
}

function install() {}
function uninstall() {}
