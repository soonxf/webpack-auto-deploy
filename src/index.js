import { promises as fsPromises } from "fs";
import ora from "ora";
import chalk from "chalk";
import { promisify } from "util";
import { Client } from "ssh2";
import enquirer from "./enquirer.js"; // 确保 enquirer.js 支持 ESM
import {
  isWindowsOrLinuxPath,
  toNormalize,
  deleteDirectory,
  uploadDirectory,
  backup,
  compress,
  isObject,
} from "./utils.js";

// Webpack自动部署类
export default class WebpackAutoDeploy {
  constructor(options) {
    this.fileName = "";
    this.options = {};
    this.Client = new Client();

    this.initApp(options).catch(error => {
      console.error(chalk.red("初始化应用失败:"), error);
    });
  }

  // 初始化应用
  async initApp(options) {
    const option = await enquirer.selectEnv(isObject(options) ? [options] : options);

    if (!option) return;

    this.options = {
      ...option,
      localPath: toNormalize(option.localPath),
      remotePath: toNormalize(option.remotePath),
    };

    const { appName, environment } = this.options;

    this.fileName = `backups_${appName}_${environment}_${new Date().__format(
      "yyyy_MM_dd_hh_mm_ss",
    )}_${String.__generateRandomString()}.tar.gz`;

    if (this.options.compress) {
      await this.compressLocalFiles();
    }
    const isConnected = await enquirer.connect();
    if (isConnected) {
      this.connect();
    }
  }

  // 压缩本地文件
  async compressLocalFiles() {
    const spinner = ora("正在压缩本地文件...\n").start();
    try {
      const { localPath } = this.options;
      const response = await compress(this.fileName, localPath);
      if (response) {
        spinner.succeed(chalk.green("压缩成功"));
        spinner.succeed(chalk.green(`保存路径:${response}`));
      } else {
        spinner.fail(chalk.red("压缩失败"));
      }
    } catch (error) {
      spinner.fail(chalk.red("压缩失败"));
      throw error; // 抛出错误，以便调用者处理
    }
  }

  // 连接到服务器
  async connect() {
    const spinner = ora("正在连接服务器...\n").start();
    try {
      const { host, port, username, password, privateKey, passphrase } = this.options.serverOptions;

      const privateKeyContent = privateKey ? await fsPromises.readFile(toNormalize(privateKey)) : undefined;

      this.Client.connect({
        host,
        port,
        username,
        password,
        passphrase,
        privateKey: privateKeyContent,
      });

      this.Client.on("ready", async () => {
        spinner.succeed(chalk.green("连接成功"));
        await this.execBackup();
      });

      this.Client.on("error", err => {
        console.error(chalk.red("连接错误:"), err);
        spinner.fail(chalk.red("连接失败"));
      });
    } catch (error) {
      spinner.fail(chalk.red("连接失败"));
      throw error; // 抛出错误，以便调用者处理
    }
  }

  async execBackup() {
    const { remotePath } = this.options;

    if (!isWindowsOrLinuxPath(remotePath)) {
      this.Client.end();
      console.log(chalk.red(`${remotePath} 不是一个合法的路径`));
      return;
    }

    const response = await backup(this.Client, this.fileName, remotePath);

    if (response === 2) return;

    await this.deleteDirectory(response);
  }
  deleteDirectory(execBackup) {
    return new Promise(async (resolve, reject) => {
      try {
        const { localPath, remotePath } = this.options;

        const sftpSync = promisify(this.Client.sftp.bind(this.Client));

        const sftp = await sftpSync();

        if (!sftp) return resolve(false);

        if (execBackup === 0) return await this.upload(sftp, localPath, remotePath);

        const response = await enquirer.remove();

        if (response) await deleteDirectory(sftp, remotePath);

        await this.upload(sftp, localPath, remotePath);
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
}
