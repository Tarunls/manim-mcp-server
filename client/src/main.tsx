import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource-variable/caveat";
import { App } from "./App";
import { RequireAuth } from "./auth";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RequireAuth>
      <App />
    </RequireAuth>
  </React.StrictMode>,
);
