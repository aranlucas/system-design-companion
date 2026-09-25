import { createRoot } from "react-dom/client";
import { Canvas } from "./canvas.tsx";
import { Home } from "./home.tsx";
import "./styles.css";

const m = location.pathname.match(/^\/d\/([A-Za-z0-9_-]+)/);
const key = new URLSearchParams(location.search).get("k");

createRoot(document.getElementById("root")!).render(
  m && key ? <Canvas id={m[1]} k={key} /> : <Home />,
);
