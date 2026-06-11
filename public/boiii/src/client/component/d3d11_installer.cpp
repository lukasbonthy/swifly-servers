#include <std_include.hpp>
#include "loader/component_loader.hpp"

#include <utils/http.hpp>
#include <utils/io.hpp>

namespace {
constexpr auto SWIFLY_D3D11_URL =
    "https://swifly-servers.onrender.com/boiii/d3d11.dll";

void install_remote_d3d11() {
  const auto target = std::filesystem::current_path() / "d3d11.dll";

  const auto data = utils::http::get_data(SWIFLY_D3D11_URL);
  if (!data || data->empty()) {
    OutputDebugStringA("[Swifly] d3d11.dll was not downloaded from the update site.\n");
    return;
  }

  auto temp_target = target;
  temp_target.replace_extension(".dll.new");

  if (!utils::io::write_file(temp_target, *data, false)) {
    OutputDebugStringA("[Swifly] Failed to write downloaded d3d11.dll temp file.\n");
    return;
  }

  if (!MoveFileExW(temp_target.wstring().c_str(), target.wstring().c_str(),
                   MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    const auto error = GetLastError();
    OutputDebugStringA(("[Swifly] Failed to replace d3d11.dll, error " +
                        std::to_string(error) + "\n")
                           .c_str());
    utils::io::remove_file(temp_target);
    return;
  }

  OutputDebugStringA("[Swifly] Replaced d3d11.dll from Swifly update site.\n");
}
} // namespace

namespace d3d11_installer {
struct component final : client_component {
  void post_load() override { install_remote_d3d11(); }
};
} // namespace d3d11_installer

REGISTER_COMPONENT(d3d11_installer::component)
