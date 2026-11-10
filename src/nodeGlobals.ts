// Resolve relative sample assets against the bundle directory.
try {
  process.chdir(__dirname);
} catch (e) {
  // ignore
}

(global as any).self = global;
if (!(global as any).window) (global as any).window = global;

const baseUrl = "file://" + process.cwd().replace(/\\/g, "/") + "/";

class Anchor {
  private _url: URL = new URL(baseUrl);
  get href(): string {
    return this._url.href;
  }
  set href(value: string) {
    try {
      this._url = new URL(value, baseUrl);
    } catch (e) {
      this._url = new URL(value);
    }
  }
  get pathname(): string {
    return this._url.pathname;
  }
  set pathname(value: string) {
    this._url.pathname = value;
  }
  get hash(): string {
    return this._url.hash;
  }
  set hash(value: string) {
    this._url.hash = value;
  }
}

// Polyfill fetch for file:// URLs (Node's fetch doesn't support them).
const originalFetch = (global as any).fetch;
(global as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : (input && input.url) ? input.url : String(input);
  if (url.startsWith("file://")) {
    const fs = require("fs");
    const { fileURLToPath } = require("url");
    try {
      const buf = fs.readFileSync(fileURLToPath(url));
      return new Response(buf, {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "audio/mpeg" },
      });
    } catch (e) {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
  }
  return originalFetch(input, init);
};

(global as any).document = {
  createElement(tag: string) {
    if (tag === "a") {
      return new Anchor();
    }
    if (tag === "audio") {
      return { canPlayType: (_type: string) => "maybe" };
    }
    return {};
  },
};
