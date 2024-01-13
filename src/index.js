import fs from "fs";
import ora from "ora";
import chalk from "chalk";
import enquirer from "./enquirer.js"; // 确保 enquirer.js 支持 ESM
import { promisify } from "util";
import "./utils.js";
import { Client } from "ssh2";
import { isWindowsOrLinuxPath, deleteDirectory, uploadDirectory, compress } from "./utils.js";

import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

// 获取当前文件的路径
const __filename = fileURLToPath(import.meta.url);
// 获取当前文件所在目录的路径
const __dirname = dirname(__filename);

class WebpackAutoDeploy {
  constructor(options) {
    this.fileName = "";
    this.options = {};
    this.Client = {};

    this.initApp(options);
  }
  async initApp(options) {
    await this.generateConfig();

    const option = await enquirer.selectEnv(this.isObject(options) ? [options] : options);

    if (option === undefined) return;

    this.options = option;
    this.Client = new Client();

    const { appName, environment } = this.options;
    const fileName = `backups_${appName}_${environment}_${String.__generateRandomString()}.tar.gz`;
    this.fileName = fileName;

    const { compress: _compress } = this.options;
    if (_compress) {
      const spinner = ora("正在压缩本地文件...\n").start();
      try {
        const { localPath } = this.options;
        const response = await compress(this.fileName, localPath);
        if (response) {
          spinner.succeed(chalk.green("压缩成功"));
          spinner.succeed(chalk.green(`保存路径:${response}`));
        } else spinner.fail(chalk.red("压缩失败"));
      } catch (error) {
        spinner.fail(chalk.red("压缩失败"));
      }
    }
    const response = await enquirer.connect();
    response && this.connect();
  }
  async generateConfig() {
    const files = fs.readdirSync(resolve(__dirname, "../", "../", "../"));
    if (!files.includes("webpack.deploy.mjs")) {
      const spinner = ora("正在生成配置文件...\n").start();
    }
  }
  async connect() {
    const spinner = ora("正在连接服务器...\n").start();
    try {
      const {
        serverOptions: { host, port, username, password, privateKey, passphrase },
      } = this.options;

      this.Client.connect({
        host,
        port,
        username,
        password,
        passphrase,
        privateKey: privateKey ? fs.readFileSync(privateKey) : undefined,
      });

      this.Client.on("ready", async (err, stream) => {
        if (!!err) {
          console.log(chalk.red(err));
          spinner.fail(chalk.red("连接失败"));
        } else {
          spinner.succeed(chalk.green("连接成功"));
          await this.execBackup();
          await this.deleteDirectory();
        }
      });
      this.Client.on("error", err => spinner.fail(chalk.red(err)));
    } catch (error) {
      spinner.fail(chalk.red(error));
    }
  }
  execBackup() {
    return new Promise(async (resolve, reject) => {
      const response = await enquirer.backup();
      if (!response) return resolve(false);
      const { remotePath } = this.options;
      if (!isWindowsOrLinuxPath(remotePath)) {
        this.Client.end();
        console.log(chalk.red(`${remotePath}不是一个合法的路径`));
        return;
      }

      const targetFiles = remotePath.split(/[\\/]+/).pop();

      const spinner = ora("服务器正在备份...\n").start();
      try {
        this.Client.exec(`cd ${remotePath};cd ../;tar -czvf ${this.fileName} ${targetFiles}`, (err, stream) => {
          if (!!err) return resolve(false);
          stream.on("data", data => {});
          stream.stderr.on("data", data => {});
          stream.on("close", (code, signal) => {
            if (code === 0) {
              spinner.succeed(chalk.green("备份成功"));
              resolve(true);
              return;
            }
            spinner.fail(chalk.red("备份失败"));
            resolve(false);
            this.Client.end();
          });
        });
      } catch (error) {
        spinner.fail(chalk.red(error));
        this.Client.end();
      }
    });
  }
  deleteDirectory() {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await enquirer.remove();

        const { localPath, remotePath } = this.options;

        const sftpSync = promisify(this.Client.sftp.bind(this.Client));

        const sftp = await sftpSync();

        if (!sftp) return resolve(false);

        if (response) {
          await deleteDirectory(sftp, remotePath);
        }
        await this.upload(sftp, localPath, remotePath);
        this.Client.end();
      } catch (error) {
        console.log(chalk.red(error));
        this.Client.end();
      }
    });
  }
  async upload(sftp, localPath, remotePath) {
    await uploadDirectory(sftp, localPath, remotePath);
    this.Client.end();
  }
  isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}

export default WebpackAutoDeploy;
