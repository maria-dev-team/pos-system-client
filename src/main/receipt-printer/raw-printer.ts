import { app } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';

const WINDOWS_RAW_PRINT_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class MariaRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
  }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool GetDefaultPrinter(StringBuilder name, ref int size);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern int StartDocPrinter(IntPtr printer, int level, ref DOC_INFO_1 info);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool StartPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool WritePrinter(IntPtr printer, IntPtr bytes, int count, out int written);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool EndPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool EndDocPrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool ClosePrinter(IntPtr printer);

  public static string DefaultPrinter() {
    int size = 0;
    GetDefaultPrinter(null, ref size);
    if (size <= 0) throw new Win32Exception(Marshal.GetLastWin32Error());
    var name = new StringBuilder(size);
    if (!GetDefaultPrinter(name, ref size)) throw new Win32Exception(Marshal.GetLastWin32Error());
    return name.ToString();
  }

  public static void Print(string printerName, string path) {
    if (!OpenPrinter(printerName, out var printer, IntPtr.Zero))
      throw new Win32Exception(Marshal.GetLastWin32Error());
    var documentStarted = false;
    var pageStarted = false;
    try {
      var info = new DOC_INFO_1 { pDocName = "Maria POS receipt", pOutputFile = null, pDatatype = "RAW" };
      if (StartDocPrinter(printer, 1, ref info) == 0)
        throw new Win32Exception(Marshal.GetLastWin32Error());
      documentStarted = true;
      if (!StartPagePrinter(printer)) throw new Win32Exception(Marshal.GetLastWin32Error());
      pageStarted = true;
      var data = System.IO.File.ReadAllBytes(path);
      var pinned = GCHandle.Alloc(data, GCHandleType.Pinned);
      try {
        var offset = 0;
        while (offset < data.Length) {
          if (!WritePrinter(printer, IntPtr.Add(pinned.AddrOfPinnedObject(), offset), data.Length - offset, out var written) || written <= 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());
          offset += written;
        }
      } finally {
        pinned.Free();
      }
    } finally {
      if (pageStarted) EndPagePrinter(printer);
      if (documentStarted) EndDocPrinter(printer);
      ClosePrinter(printer);
    }
  }
}
'@
$printer = $env:MARIA_RECEIPT_PRINTER
if ([string]::IsNullOrWhiteSpace($printer)) {
  try { $printer = [MariaRawPrinter]::DefaultPrinter() } catch { exit 2 }
}
[MariaRawPrinter]::Print($printer, $env:MARIA_RECEIPT_PATH)`;

const runProcess = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: Buffer,
): Promise<number | null> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    const finish = (error?: Error, code: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(code);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Системная очередь печати не ответила вовремя.'));
    }, 30_000);
    child.once('error', () =>
      finish(new Error('Системная очередь печати отклонила чек.')),
    );
    child.once('close', (code) => finish(undefined, code));
    child.stderr.resume();
    child.stdin.once('error', () =>
      finish(new Error('Системная очередь печати отклонила чек.')),
    );
    child.stdin.end(input);
  });

export class DefaultPrinterNotFoundError extends Error {
  override name = 'DefaultPrinterNotFoundError';
}

export const sendRawReceipt = async (
  deviceName: string | null,
  data: Buffer,
  platform: NodeJS.Platform = process.platform,
): Promise<void> => {
  if (platform === 'darwin') {
    const args = [...(deviceName ? ['-d', deviceName] : []), '-o', 'raw', '-'];
    if ((await runProcess('/usr/bin/lp', args, process.env, data)) !== 0) {
      throw new Error('Системная очередь печати отклонила чек.');
    }
    return;
  }
  if (platform !== 'win32') {
    throw new Error('Печать ESC/POS не поддерживается этой системой.');
  }

  const path = join(app.getPath('temp'), `maria-receipt-${randomUUID()}.bin`);
  await writeFile(path, data, { flag: 'wx' });
  try {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const powershell = win32.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const exitCode = await runProcess(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        WINDOWS_RAW_PRINT_SCRIPT,
      ],
      {
        ...process.env,
        MARIA_RECEIPT_PATH: path,
        MARIA_RECEIPT_PRINTER: deviceName ?? '',
      },
    );
    if (exitCode === 2) {
      throw new DefaultPrinterNotFoundError(
        'Системный принтер по умолчанию не настроен.',
      );
    }
    if (exitCode !== 0) {
      throw new Error('Системная очередь печати отклонила чек.');
    }
  } finally {
    await unlink(path).catch(() => undefined);
  }
};
