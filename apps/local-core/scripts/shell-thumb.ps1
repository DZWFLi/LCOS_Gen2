param(
  [string]$InputPath,
  [string]$OutputPath,
  [int]$Width = 320,
  [int]$Height = 240
)

Add-Type -ReferencedAssemblies @("System.Drawing") -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class ShellThumb {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  private static extern int SHCreateItemFromParsingName(
    string pszPath, IntPtr pbc, ref Guid riid, out IntPtr ppv);

  [DllImport("gdi32.dll")]
  private static extern bool DeleteObject(IntPtr hObject);

  [ComImport]
  [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItemImageFactory {
    [PreserveSig]
    int GetImage(IntPtr size, int flags, out IntPtr phbm);
  }

  public static int Generate(string inputPath, string outputPath, int width, int height) {
    Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    IntPtr ppv;
    int hr = SHCreateItemFromParsingName(inputPath, IntPtr.Zero, ref iid, out ppv);
    if (hr != 0 || ppv == IntPtr.Zero) return hr == 0 ? -1 : hr;
    try {
      IShellItemImageFactory factory = (IShellItemImageFactory)Marshal.GetObjectForIUnknown(ppv);
      IntPtr size = Marshal.AllocHGlobal(8);
      Marshal.WriteInt32(size, 0, width);
      Marshal.WriteInt32(size, 4, height);
      IntPtr hbm;
      int hr2 = factory.GetImage(size, 0x1, out hbm); // SIIGBF_BIGGERSIZEOK
      Marshal.FreeHGlobal(size);
      Marshal.ReleaseComObject(factory);
      if (hr2 != 0 || hbm == IntPtr.Zero) return hr2 == 0 ? -2 : hr2;
      using (Image img = Image.FromHbitmap(hbm)) {
        img.Save(outputPath, ImageFormat.Png);
      }
      DeleteObject(hbm);
      return 0;
    } finally {
      Marshal.Release(ppv);
    }
  }
}
"@

$code = [ShellThumb]::Generate($InputPath, $OutputPath, $Width, $Height)
if ($code -eq 0) {
  Write-Output "OK $OutputPath"
} else {
  Write-Error "ShellThumb failed code=0x$($code.ToString('X8'))"
  exit 1
}
