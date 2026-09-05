# Adding a conversion node

A conversion node has three responsibilities: advertise itself in the command palette, accept a browser `File`, and return a `Output` object from `src/converters.ts`.

## 1. Add the converter

Add an async function to `src/converters.ts`. It must not call a remote service. Return:

```ts
{ blob, name: 'converted.ext', type: 'mime/type', preview, kind: 'image' | 'audio' | 'text' | 'file' }
```

`preview` should be an object URL for playable/renderable media, or a short string for text. Revoke object URLs when replacing long-lived results in a future memory-management pass.

## 2. Register the target

Add its target format to `imageTargets`, `textTargets`, or another explicit capability list. The command palette reads these lists, so unsupported choices are never silently offered.

## 3. Wire execution

In `runNode` in `src/App.tsx`, route the source file kind and target to your new converter. Keep errors descriptive: unsupported browser codecs and out-of-memory conditions should become node errors.

## 4. Declare reliability

Use **Reliable** only for predictable, browser-local conversions. Label outputs that vary by browser, are lossy, or preserve formatting imperfectly as **Experimental**. For large WASM conversion engines, show an explicit file-size / memory warning before processing.

## FFmpeg.wasm nodes

When adding FFmpeg, package its core and WASM files with Vite and reference local static URLs. Do not use a CDN at runtime. Route progress events to the node’s `processing` state and put a sensible warning before large audio/video files are loaded into memory.
