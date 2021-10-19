class AutoRollNpcSave5e {
  static MODULE_NAME = "auto-roll-npc-save-5e";
  static MODULE_TITLE = "Auto Roll NPC Save DnD5e";

  static init = async () => {
    console.log(`${this.MODULE_NAME} | Initializing ${this.MODULE_TITLE}`);

    Hooks.on('Item5e.roll', this._handleItemRoll);
  }

  static _getStatusIcon = ({ save }) => {
    if (save) {
      return '<i class="fas fa-check"></i>';
    }
    return '<i class="fas fa-times"></i>';
  }

  static _getStatusLabel = ({ save }) => {
    if (save) {
      return game.i18n.localize(`${this.MODULE_NAME}.SAVE`);
    }
    return game.i18n.localize(`${this.MODULE_NAME}.FAIL`);
  }

  static _handleItemRoll = (item, _chatMessage, _config, _actor, { userId } = {}) => {
    if (!game.user.isGM) {
      return;
    }

    if (!item.data.data?.save?.dc) {
      return;
    }

    // some items might have templates to be placed
    const itemHasTemplateFirst = item.hasAreaTarget && game.users.get(userId).can("TEMPLATE_CREATE") && canvas.activeLayer instanceof TemplateLayer;

    // run the check after measured template is placed
    if (itemHasTemplateFirst) {
      const callback = () => this._requestTargetSave(item, _chatMessage, _config, _actor, { userId });

      Hooks.once('createMeasuredTemplate', callback);

      // escape hatch to clean our hook up if the placement is canceled
      Hooks.once('renderSceneControls', (controls) => {
        if (controls.activeControl !== 'measure') {
          Hooks.off('createMeasuredTemplate', callback);
        }
      });
      return;
    }

    this._requestTargetSave(item, _chatMessage, _config, _actor, { userId });
  }

  static _requestTargetSave = async (item, _chatMessage, _config, _actor, { userId } = {}) => {
    // filters to only tokens without Player owners
    // this excludes summons which are reasonable to request a player to roll for?
    const targetedTokens = [...(game.users.get(userId)?.targets?.values() ?? [])].filter(t => !!t.actor && !t.actor.hasPlayerOwner);

    if (!targetedTokens.length) {
      return;
    }

    const abilityId = item.data.data.save.ability;
    const saveDc = item.data.data.save.dc;

    const saveResults = await Promise.all(targetedTokens.map(async (token) => this._rollAbilitySave(abilityId, token, saveDc)));

    const html = `
      <ul class="dnd5e chat-card check-npc-save-list">
        ${saveResults.map(({ token, roll, save }) => {
      const statusLabel = this._getStatusLabel({ save });

      const statusIcon = this._getStatusIcon({ save });

      return `
            <li class="card-header" data-token-id="${token.id}">
              <img class="token-image" src="${token.data.img}" title="${token.data.name}" width="36" height="36" style="transform: rotate(${token.data.rotation ?? 0}deg);">
              <h3>${token.data.name}</h3>
              <div class="roll-display">${roll.total}</div>
              <div class="status-chip ${save ? 'save' : 'fail'}">
                <span>${statusLabel}</span>
                ${statusIcon}
              </div>
              <div class="dc-display">${saveDc}</div>
            </li>
      `}).join('')}
      </ul>
    `

    const messageData = {
      whisper: ChatMessage.getWhisperRecipients('gm'),
      user: game.user.data._id,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      speaker: { alias: game.i18n.localize(`${this.MODULE_NAME}.MESSAGE_HEADER`) },
      content: html,
    }

    if (game.modules.get('betterrolls5e')?.active) {
      setTimeout(() => ChatMessage.create(messageData), 100);
    }

    if (game.modules.get('dice-so-nice')?.active) {
      Hooks.once('diceSoNiceRollComplete', () => {
        ChatMessage.create(messageData)
      })
    } else {
      ChatMessage.create(messageData)
    }
  }

  static _rollAbilitySave = async (abilityId, token, saveDc) => {
    const actor = token.actor;

    const roll = await actor.rollAbilitySave(abilityId, {
      chatMessage: false,
    });

    const save = saveDc <= roll.total;

    return {
      token,
      roll,
      save
    }
  }
}

Hooks.on("ready", AutoRollNpcSave5e.init);

/**
 * Most of this class is adapted directly from Core's handling of Combatants
 * in the combat tracker.
 */
class AutoRollNpcSave5eChat {
  _highlighted = null;

  /**
   * Register the chat listeners to handle hovering over names and such.
   */
  static registerChatListeners = (_chatLog, html) => {
    html.on('mouseenter', '.check-npc-save-list > li', this._onCombatantHoverIn);
    html.on('mouseleave', '.check-npc-save-list > li', this._onCombatantHoverOut);
    html.on('click', '.check-npc-save-list > li', this._onCombatantMouseDown);
  }

  static _onCombatantHoverIn = (event) => {
    event.preventDefault();

    if (!canvas.ready) return;
    const li = event.currentTarget;
    const token = canvas.tokens.get(li.dataset.tokenId);
    if (token?.isVisible) {
      if (!token._controlled) token._onHoverIn(event);
      this._highlighted = token;
    }
  }

  static _onCombatantHoverOut = (event) => {
    event.preventDefault();
    if (!canvas.ready) return;

    if (this._highlighted) this._highlighted._onHoverOut(event);
    this._highlighted = null;
  }

  static _onCombatantMouseDown = async (event) => {
    event.preventDefault();

    const li = event.currentTarget;
    const token = canvas.tokens.get(li.dataset.tokenId);
    if (!token?.actor?.testUserPermission(game.user, "OBSERVED")) return;
    const now = Date.now();

    // Handle double-left click to open sheet
    const dt = now - this._clickTime;
    this._clickTime = now;
    if (dt <= 250) {
      if (token.actor) token.actor.sheet.render(true);
    }

    if (!canvas.ready) return;

    // Control and pan on single-left
    else {
      token.control({ releaseOthers: true });
    }
  }
}

Hooks.on('renderChatLog', AutoRollNpcSave5eChat.registerChatListeners);