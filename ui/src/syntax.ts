import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";

export const syntax = hljs.newInstance();
syntax.registerLanguage("bash", bash);
syntax.registerLanguage("javascript", javascript);
syntax.registerLanguage("typescript", typescript);
syntax.registerLanguage("json", json);
syntax.registerLanguage("python", python);
syntax.registerLanguage("yaml", yaml);
