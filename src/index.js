import fs from "fs";
import ora from "ora";
import chalk from "chalk";
import enquirer from "./enquirer.js"; // 确保 enquirer.js 支持 ESM
import { promisify } from "util";
import { Client } from "ssh2";
import { isWindowsOrLinuxPath, deleteDirectory, uploadDirectory, backup, compress, mkdirRemotePath } from "./utils.js";

// import { fileURLToPath } from "url";
// import { resolve, dirname } from "path";

// 获取当前文件的路径
// const __filename = fileURLToPath(import.meta.url);
// 获取当前文件所在目录的路径
// const __dirname = dirname(__filename);

export default class WebpackAutoDeploy {
  constructor(options) {
    this.fileName = "";
    this.options = {};
    this.Client = {};

    this.initApp(options);
  }
  async initApp(options) {
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
  async connect() {
    const spinner = ora("正在连接服务器...\n").start();
    try {
      const {
        serverOptions: {
          host = undefined,
          port = undefined,
          username = undefined,
          password = undefined,
          privateKey = undefined,
          passphrase = undefined,
        },
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
        }
      });
      this.Client.on("error", err => spinner.fail(chalk.red(err)));
    } catch (error) {
      spinner.fail(chalk.red(error));
    }
  }
  async execBackup() {
    const { remotePath } = this.options;

    if (!isWindowsOrLinuxPath(remotePath)) {
      this.Client.end();
      console.log(chalk.red(`${remotePath}不是一个合法的路径`));
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

        if (response) {
          await deleteDirectory(sftp, remotePath);
        }

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
  isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
