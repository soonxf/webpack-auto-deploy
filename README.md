## 简介

> 用于自动部署打包后的文件上传到服务器

## 安装

```
npm install webpack-auto-deploy --save-dev
```

## 使用


> 初次执行命令会在当前命令执行的目录下生成一个 webpack.deploy.json 文件，用于配置服务器信息


> 注意: 涉及到的本地路径都是相对于当前执行命令的目录
>
> 例: 执行命令的目录为 D:/project , 那么配置文件中 privateKey 配置为 ./rsa.txt ,则相互拼接得到的是 D:/project/rsa.txt
>
> 涉及到的路径有 localPath 和 privateKey


> 注意: 涉及到的远程路径应当都是绝对路径
>
> 例: remotePath 则需要服务器的绝对路径 /var/www/html


```javascript

// package.json 新增命令

"scripts": {
  "deploy": "webpack-auto-deploy",
}
```

> 项目根目录执行新增的命令

```
npm run deploy
```

## 我的邮箱

```
soonxf@dingtalk.com
```
