class AutoRollNpcSave5e {
  static MODULE_NAME = "auto-roll-npc-save-5e";
  static MODULE_TITLE = "Auto Roll NPC Save DnD5e";
  static SOCKET;

  static init = async () => {
    console.log(`${this.MODULE_NAME} | Initializing ${this.MODULE_TITLE}`);

    Hooks.on('dnd5e.useItem', this._handleUseItem);
  }

  static initSocket = () => {
    this.SOCKET = socketlib.registerModule(this.MODULE_NAME);
    this.SOCKET.register('requestTargetSave', this._requestTargetSave);
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

  /**
   * Happens when the Item is rolled on any client machine.
   * Checks if the item has a save DC defined.
   * Requests the GM make the save.
   */
  static _handleUseItem = (item) => {
    if (!item.system?.save?.dc || !item.system?.save?.ability) {
      return;
    }
    
    this._requestGMRollSave(item);
  }

  /**
   * Happens on the client machine after it expects targeting to be done.
   * Gets the targeted tokens and requests the GM roll a save for them via socket.
   * @param {*} item 
   * @param {*} _chatMessage 
   * @param {*} _config 
   * @param {*} _actor 
   * @returns 
   */
  static _requestGMRollSave = async (item) => {
    // filters to only tokens without Player owners
    // this excludes summons which are reasonable to request a player to roll for?
    const targetedTokens = [...(game.user.targets?.values() ?? [])].filter(t => !!t.actor && !t.actor.hasPlayerOwner);

    if (!targetedTokens.length) {
      return;
    }

    const abilityId = item.system.save.ability;
    const saveDc = item.system.save.dc;
    const tokenUuids = targetedTokens.map(token => token.document.uuid);

    this.SOCKET.executeAsGM(this._requestTargetSave, abilityId, saveDc, tokenUuids, item.parent);
  }

  /**
   * This executes as GM to ensure only the GM is prompted about the NPC saves
   * @param {string} abilityId - what ability is being asked a save for
   * @param {number} saveDc - save dc
   * @param {Array<string>} tokenUuids - uuids for the actors being targeted
   * @param {Actor5e} actor - the actor requesting the save (for chat message creation)
   */
  static _requestTargetSave = async (abilityId, saveDc, tokenUuids, actor) => {
    // get all token actors save results
    const saveResults = await Promise.all(tokenUuids.map(async (tokenUuid) => {
      const token = await fromUuid(tokenUuid);

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
    }));

    const html = `
      <ul class="dnd5e chat-card check-npc-save-list">
        ${saveResults.map(({ token, roll, save }) => {
      const statusLabel = this._getStatusLabel({ save });

      const statusIcon = this._getStatusIcon({ save });

      return `
            <li class="card-header" data-token-id="${token.id}">
              <img class="token-image" src="${token.texture.src}" title="${token.name}" width="36" height="36" style="transform: rotate(${token.rotation ?? 0}deg);">
              <h3>${token.name}</h3>
              <div class="roll-display" title="${roll.formula}">${roll.total}</div>
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
      //whisper: ChatMessage.getWhisperRecipients('gm'),
      blind: false,
      user: game.user._id,
      flags: { [this.MODULE_NAME]: { isResultCard: true } },
      type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      speaker: ChatMessage.getSpeaker({actor}),
      flavor: game.i18n.localize(`${this.MODULE_NAME}.MESSAGE_HEADER`),
      content: html,
    }

    ChatMessage.create(messageData);
  }
}

Hooks.on("ready", AutoRollNpcSave5e.init);
Hooks.once("socketlib.ready", AutoRollNpcSave5e.initSocket);

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
