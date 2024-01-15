## 简介

> 用于自动部署打包后的文件上传到服务器

## 安装

```
npm install webpack-auto-deploy --save-dev
```

## 使用

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
    appName: "项目名称1",
    compress: true, //是否压缩
    environment: "dev", //开发环境
    localPath: resolve(__dirname, "./dist"), //本地打包目录,即需要上传的目录
    remotePath: "/var/www/html", //远程服务器目录
    serverOptions: {
      host: "192.168.1.111", //服务器ip
      port: "22", //服务器端口
      username: "root", //服务器用户名
      password: "123456", //服务器密码,密钥登陆不需要
      passphrase: "123456", //密钥登陆需要的话
      privateKey: resolve(__dirname, "./rsa.txt"), //密钥地址,密码登录不需要
    },
  },,
  {
    appName: "项目名称2",
    compress: true, //是否压缩
    environment: "test", //测试环境
    localPath: resolve(__dirname, "./dist"), //本地打包目录,即需要上传的目录
    remotePath: "/var/www/html", //远程服务器目录
    serverOptions: {
      host: "192.168.1.111", //服务器ip
      port: "22", //服务器端口
      username: "root", //服务器用户名
      password: "123456", //服务器密码,密钥登陆不需要
      passphrase: "123456", //密钥登陆需要的话
      privateKey: resolve(__dirname, "./rsa.txt"), //密钥地址,密码登录不需要
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

## 我的邮箱

```
soonxf@dingtalk.com
```
