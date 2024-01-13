## 简介

> 用于自动部署打包后的文件上传到服务器

## 安装

```
npm install webpack-auto-deploy --save-dev
```

# 使用

> 根目录新建文件 webpack.deploy.mjs


```
import WebpackAutoDeploy from "webpack-auto-deploy";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

// 获取当前文件的路径
const __filename = fileURLToPath(import.meta.url);
// 获取当前文件所在目录的路径
const __dirname = dirname(__filename);

const config = [
  {
    appName: "项目名称",
    compress: true,
    environment: "dev",
    localPath: resolve(__dirname, "./dist"),
    remotePath: "/var/www/html",
    serverOptions: {
      host: "192.168.1.111",
      port: "22",
      username: "root",
      // password: "服务器密码,密钥登陆的话不需要",
      passphrase: "123456", //密钥登陆的话需要
      privateKey: resolve(__dirname, "./rsa.txt"), //密钥地址
    },
  },
  {
    appName: "项目名称1",
    compress: true,
    environment: "dev",
    localPath: resolve(__dirname, "./dist"),
    remotePath: "/var/www/html",
    serverOptions: {
      host: "192.168.1.111",
      port: "22",
      username: "root",
      // password: "服务器密码,密钥登陆的话不需要",
      passphrase: "123456", //密钥登陆的话需要
      privateKey: resolve(__dirname, "./rsa.txt"), //密钥地址
    },
  },
];

new WebpackAutoDeploy(config);
```

> package.json 新增命令

```
"scripts": {
  "deploy": "node webpack.deploy.mjs",
}
```

> 执行命令

```
npm run deploy
```
