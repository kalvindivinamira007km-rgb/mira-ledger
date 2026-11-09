/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/@anthropic-ai/sdk@1.6.0/internal/node.browser.mjs
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
var s=(()=>{class t extends Error{constructor(e,n){super(e,n),Object.defineProperty(this,"name",{value:new.target._errorName,writable:!0,configurable:!0})}}return t._errorName="AnthropicError",t})();function r(t){return new Proxy({},{get(o,e){if(typeof e!="symbol")throw new s(`\`${t}.${e}\` is not available in this environment; it needs a Node.js-compatible runtime`)}})}const c=r("child_process"),i=r("crypto"),a=r("fs"),u=r("os"),l=r("path"),p=r("stream"),h=r("util");export{c as child_process,i as crypto,a as fs,u as os,l as path,p as stream,h as util};
//# sourceMappingURL=/sm/6fb4ba28870f61f99f97e2475d19460bd677067852720e5dadfd79fbffa8e7c1.map