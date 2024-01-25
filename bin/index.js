#!/usr/bin/env node

import utils from "../src/utils.js";
import WebpackAutoDeploy from "../src/index.js";

import { fileURLToPath } from "url";
import { dirname, join } from "path";

// 获取当前文件的路径
const __filename = fileURLToPath(import.meta.url);
// 获取当前文件所在目录的路径
const __dirname = dirname(__filename);

// 使用 async 函数
async function run() {
  const filePath = join(process.cwd(), "webpack.deploy.json");
  const exists = await utils.checkFileExists(filePath);
  if (exists) {
    const config = await utils.readJson(filePath);

    const _config = utils.formatConfig(config);
    new WebpackAutoDeploy(_config);
  } else {
    await utils.generateTemplateConfig(filePath);
    await utils.readJson(filePath);
  }
}

run().catch(console.error);
