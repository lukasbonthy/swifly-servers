Swifly patch overlay

Copy/merge the folders in this ZIP into the root of your boiii-client checkout.

Then run:
  .\generate.bat

Then rebuild Release x64.

What is included:
- data/launcher/main.html: visible Vanilla Mode launch option.
- data/launcher/main.js/main.css/images: launcher files to put into your update site under public/boiii/data/launcher too.
- tools/patch_swifly_launcher.ps1: generation-time branding + Vanilla Mode injector.
- src/client/component/d3d11_installer.cpp: downloads https://swifly-servers.onrender.com/boiii/d3d11.dll and overwrites the BO3-folder d3d11.dll.

Important:
- For Vanilla Mode to appear in players' launchers through your update site, upload the included data/launcher files to public/boiii/data/launcher/.
- For d3d11.dll replacement, upload your d3d11.dll to public/boiii/d3d11.dll on the site.
