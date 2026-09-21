import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/glass.css";
import App from "./App";
import { LocaleProvider } from "./i18n";

const container = document.getElementById("root");

const root = createRoot(container!);

root.render(
  <React.StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </React.StrictMode>
);
