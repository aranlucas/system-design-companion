# Service icon

Generated with the built-in imagegen tool. The same connected-node mark is used
for the website favicon, home page, Apple touch icon, and MCP server identity.

## Final generation prompt

Use case: logo-brand. Create one finished square app icon for System Design Companion, a shared architecture diagram canvas. OPAQUE image: flat solid violet #6741d9 background covering every pixel edge to edge. Center a bold pure-white emblem consisting of three rounded-square diagram nodes connected by thick rounded right-angle lines in a compact zigzag flow: top-left node connects rightward then down to middle-right node, which connects leftward then down to bottom-left node. All three nodes same size. Very simple crisp flat vector-like graphic, balanced inset margins, recognizable at 16px. Absolutely no transparency, no alpha cutouts, no rounded outer tile corners, no gradient, no texture, no lighting, no shadow, no blemishes, no text, no watermark. Square 1024x1024.

## Assets

- `public/icons/system-design-source.png`: original generated artwork.
- `public/icons/system-design-{32,128,512}.png`: resized web and MCP assets.
- `public/favicon.ico`: 16, 32, and 48 pixel favicon sizes.
- `public/apple-touch-icon.png`: 180 pixel touch icon.

MCP icons use absolute URLs on the request origin and require no credentials.
Clients choose whether to display the advertised server icon. Deploy the service
and reconnect the client to pick up the new metadata; cached icons may take time
to refresh.
