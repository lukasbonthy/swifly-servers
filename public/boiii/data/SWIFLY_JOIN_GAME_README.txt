Swifly data-side Join Game patch

What this ZIP changes:
- The in-game lobby Server Browser button is renamed to JOIN GAME.
- Clicking it runs the native client command: join_swifly_server
- The server browser UI is trimmed toward Swifly Team Deathmatch/base-map behavior.

Important:
Lua/data files can change BO3 menus and can run Engine.Exec commands, but they cannot safely fetch HTTPS JSON by themselves in the BO3 Lua sandbox.
The Swifly client must expose a native command named join_swifly_server that:
1. GETs https://swifly-servers.onrender.com/api/servers
2. Chooses the first available non-full, non-passworded server
3. Executes connect <address>:<port>

If that command is not present, the Join Game button will do nothing except run an unknown command.
