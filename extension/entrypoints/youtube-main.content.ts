// MAIN-world content script: runs in the page's own JS context, so it can
// read `window.ytInitialPlayerResponse` directly. It answers a postMessage
// handshake from the ISOLATED-world content.ts, which cannot see page globals.
//
// NOTE on filename: WXT (0.20.27) determines entrypoint type purely from the
// filename glob (`*.content.[jt]s` -> "content-script"), independent of the
// `world` option in the exported definition. A plain `youtube-main.ts` would
// be misclassified as an "unlisted-script" and never injected as a content
// script at all -- hence the `.content.ts` suffix here.
const YT_PLAYER_REQUEST = "YT_PLAYER";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  main() {
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      if (event.data?.tnReq !== YT_PLAYER_REQUEST) return;
      window.postMessage(
        { tnRes: YT_PLAYER_REQUEST, player: (window as any).ytInitialPlayerResponse ?? null },
        "*"
      );
    });
  },
});
