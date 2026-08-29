import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { App } from "./App";
import "./theme.css";
import "./marketing.css";
import "./studio.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
