#include <std_include.hpp>
#include "loader/component_loader.hpp"

#include "scheduler.hpp"
#include "game/game.hpp"

#include <utils/flags.hpp>

namespace vanilla_mode {
namespace {
bool enabled() { return utils::flags::has_flag("vanilla"); }

void apply_vanilla_defaults() {
  if (!enabled()) {
    return;
  }

  game::Dvar_SetFromStringByName("cg_unlockall_loot", "0", true);
  game::Dvar_SetFromStringByName("cg_unlockall_purchases", "0", true);
  game::Dvar_SetFromStringByName("cg_unlockall_attachments", "0", true);
  game::Dvar_SetFromStringByName("cg_unlockall_camos_and_reticles", "0", true);
  game::Dvar_SetFromStringByName("cg_unlockall_calling_cards", "0", true);
  game::Dvar_SetFromStringByName("cg_unlockall_specialists_outfits", "0", true);
  game::Dvar_SetFromStringByName("cg_unlockall_cac_slots", "0", true);
  game::Dvar_SetFromStringByName("ui_enableAllHeroes", "0", true);

  OutputDebugStringA("[Swifly] Vanilla Mode is active. Unlock/stat dvars were disabled.\n");
}
} // namespace

struct component final : generic_component {
  void post_unpack() override {
    scheduler::once(apply_vanilla_defaults, scheduler::pipeline::dvars_loaded);
  }
};
} // namespace vanilla_mode

REGISTER_COMPONENT(vanilla_mode::component)
