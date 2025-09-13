// index.js
require('dotenv').config();
const fs = require('fs');
const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  PermissionFlagsBits, SlashCommandBuilder, Events,
  EmbedBuilder
} = require('discord.js');

const DATA_FILE = './data/config.json';
const GUILD_ID = process.env.GUILD_ID;

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync('./data', { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
  }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

const db = loadData();
const getGuildConfig = (gid) => {
  if (!db[gid]) db[gid] = {
    protectedRoleIds: [],
    bypassRoleIds: [],
    deleteMessages: (process.env.DELETE_OFFENDING_MESSAGES === 'true'),
    timeoutSeconds: 60,
    logsChannelId: undefined,
    warns: {}
  };
  if (!db[gid].warns) db[gid].warns = {};
  return db[gid];
};

const commands = [
  new SlashCommandBuilder()
    .setName('protect-role')
    .setDescription('Manage protected roles (members of these roles cannot be mentioned).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sc =>
      sc.setName('add')
        .setDescription('Add a protected role.')
        .addRoleOption(o => o.setName('role').setDescription('Role to protect').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('remove')
        .setDescription('Remove a protected role.')
        .addRoleOption(o => o.setName('role').setDescription('Role to unprotect').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('list').setDescription('List protected roles.')
    ),

  new SlashCommandBuilder()
    .setName('bypass-role')
    .setDescription('Manage bypass roles (members with these roles are exempt).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sc =>
      sc.setName('add')
        .setDescription('Add a bypass role.')
        .addRoleOption(o => o.setName('role').setDescription('Role allowed to ping').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('remove')
        .setDescription('Remove a bypass role.')
        .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('list').setDescription('List bypass roles.')
    ),

  new SlashCommandBuilder()
    .setName('anti-mention')
    .setDescription('Show or set anti-mention settings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sc => sc.setName('show').setDescription('Show current settings.'))
    .addSubcommand(sc =>
      sc.setName('set-delete')
        .setDescription('Enable/disable deleting offending messages.')
        .addBooleanOption(o => o.setName('enabled').setDescription('Delete messages?').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('set-timeout')
        .setDescription('Set offender timeout length in seconds (10–86400).')
        .addIntegerOption(o =>
          o.setName('seconds').setDescription('Duration in seconds').setRequired(true).setMinValue(10).setMaxValue(86400)
        )
    )
    .addSubcommand(sc =>
      sc.setName('set-logs')
        .setDescription('Choose the channel where logs will be posted.')
        .addChannelOption(o => o.setName('channel').setDescription('Logs channel').setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Show/reset warn counts.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sc =>
      sc.setName('show')
        .setDescription('Show a user’s warn count.')
        .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('reset')
        .setDescription('Reset a user’s warn count.')
        .addUserOption(o => o.setName('user').setDescription('User to reset').setRequired(true))
    )
].map(c => c.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function registerGuildCommands(appId) {
  if (!GUILD_ID) throw new Error('GUILD_ID missing in .env');
  await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
  console.log('Slash commands registered to guild:', GUILD_ID);
}

function authorHasBypass(authorMember, bypassRoleIds) {
  if (!authorMember) return false;
  return authorMember.roles.cache.some(r => bypassRoleIds.includes(r.id));
}

function mentionsProtectedMember(message, protectedRoleIds) {
  if (!message.mentions || message.mentions.members?.size === 0) return false;
  for (const [, mentionedMember] of message.mentions.members) {
    if (mentionedMember.roles.cache.some(r => protectedRoleIds.includes(r.id))) return true;
  }
  return false;
}

function incWarn(gid, uid) {
  const cfg = getGuildConfig(gid);
  if (!cfg.warns[uid]) cfg.warns[uid] = 0;
  cfg.warns[uid] += 1;
  saveData();
  return cfg.warns[uid];
}
function getWarns(gid, uid) {
  const cfg = getGuildConfig(gid);
  return cfg.warns[uid] || 0;
}
function resetWarns(gid, uid) {
  const cfg = getGuildConfig(gid);
  cfg.warns[uid] = 0;
  saveData();
}

async function sendLog(message, cfg, actionSummary, mentionedProtectedUsers) {
  if (!cfg.logsChannelId) return;
  const channel = message.guild.channels.cache.get(cfg.logsChannelId) ||
                  await message.guild.channels.fetch(cfg.logsChannelId).catch(() => null);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('Anti-Mention Action')
    .setTimestamp(new Date())
    .setColor(0xff5555)
    .addFields(
      { name: 'Offender', value: `${message.author} \`(${message.author.id})\``, inline: false },
      { name: 'Protected mentioned', value: mentionedProtectedUsers.length ? mentionedProtectedUsers.map(u => `${u} \`(${u.id})\``).join('\n') : '—', inline: false },
      { name: 'Action', value: actionSummary, inline: false },
    );

  if (message.guild && message.channel && message.id) {
    try {
      const url = `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`;
      embed.addFields({ name: 'Message', value: `[Jump to message](${url})` });
    } catch {}
  }

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function handleOffense(message, cfg) {
  const offender = await message.guild.members.fetch(message.author.id);
  const ms = Math.max(10, Math.min(cfg.timeoutSeconds, 86400)) * 1000;

  const protectedMentioned = [];
  for (const [, m] of message.mentions.members) {
    if (m.roles.cache.some(r => cfg.protectedRoleIds.includes(r.id))) protectedMentioned.push(m.user);
  }

  const warnsCount = incWarn(message.guild.id, message.author.id);
  const warning = `🚫 Please do not mention members with protected roles.\nYou have been timed out for **${cfg.timeoutSeconds}s**.\nCurrent warns: **${warnsCount}**.`;

  try {
    await offender.timeout(ms, 'Mentioned protected role/member');

    if (cfg.deleteMessages) {
      await message.delete().catch(() => {});
      await message.author.send(warning).catch(() => {});
    } else {
      await message.reply({ content: warning, allowedMentions: { parse: [] } }).catch(() => {});
    }

    const actionSummary =
      `Timed out for ${cfg.timeoutSeconds}s` +
      (cfg.deleteMessages ? ' • Message deleted' : ' • Message kept') +
      ` • Warns now: ${warnsCount}`;
    await sendLog(message, cfg, actionSummary, protectedMentioned);
  } catch (err) {
    console.error('handleOffense error:', err);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try { await registerGuildCommands(c.user.id); }
  catch (e) { console.error('Command registration failed:', e); }
});

client.on(Events.InteractionCreate, async (ix) => {
  if (!ix.isChatInputCommand()) return;
  const gid = ix.guildId;
  if (!gid) return ix.reply({ content: 'Use commands in a server.', flags: 64 });

  const cfg = getGuildConfig(gid);

  try {
    if (ix.commandName === 'protect-role') {
      const sub = ix.options.getSubcommand();
      if (sub === 'add') {
        const role = ix.options.getRole('role', true);
        if (!cfg.protectedRoleIds.includes(role.id)) cfg.protectedRoleIds.push(role.id);
        saveData();
        return ix.reply({ content: `✅ Protected: <@&${role.id}>`, flags: 64 });
      }
      if (sub === 'remove') {
        const role = ix.options.getRole('role', true);
        cfg.protectedRoleIds = cfg.protectedRoleIds.filter(id => id !== role.id);
        saveData();
        return ix.reply({ content: `✅ Unprotected: <@&${role.id}>`, flags: 64 });
      }
      if (sub === 'list') {
        const txt = cfg.protectedRoleIds.length ? cfg.protectedRoleIds.map(id => `<@&${id}>`).join(', ') : '*(none)*';
        return ix.reply({ content: `**Protected roles:** ${txt}`, flags: 64 });
      }
    }

    if (ix.commandName === 'bypass-role') {
      const sub = ix.options.getSubcommand();
      if (sub === 'add') {
        const role = ix.options.getRole('role', true);
        if (!cfg.bypassRoleIds.includes(role.id)) cfg.bypassRoleIds.push(role.id);
        saveData();
        return ix.reply({ content: `✅ Bypass added: <@&${role.id}>`, flags: 64 });
      }
      if (sub === 'remove') {
        const role = ix.options.getRole('role', true);
        cfg.bypassRoleIds = cfg.bypassRoleIds.filter(id => id !== role.id);
        saveData();
        return ix.reply({ content: `✅ Bypass removed: <@&${role.id}>`, flags: 64 });
      }
      if (sub === 'list') {
        const txt = cfg.bypassRoleIds.length ? cfg.bypassRoleIds.map(id => `<@&${id}>`).join(', ') : '*(none)*';
        return ix.reply({ content: `**Bypass roles:** ${txt}`, flags: 64 });
      }
    }

    if (ix.commandName === 'anti-mention') {
      const sub = ix.options.getSubcommand();
      if (sub === 'show') {
        return ix.reply({
          content:
            `**Protected roles:** ${cfg.protectedRoleIds.length ? cfg.protectedRoleIds.map(id => `<@&${id}>`).join(', ') : '*(none)*'}\n` +
            `**Bypass roles:** ${cfg.bypassRoleIds.length ? cfg.bypassRoleIds.map(id => `<@&${id}>`).join(', ') : '*(none)*'}\n` +
            `**Delete messages:** ${cfg.deleteMessages ? '✅ enabled' : '❌ disabled'}\n` +
            `**Timeout:** ${cfg.timeoutSeconds}s\n` +
            `**Logs channel:** ${cfg.logsChannelId ? `<#${cfg.logsChannelId}>` : '*(none)*'}`,
          flags: 64,
        });
      }
      if (sub === 'set-delete') {
        const enabled = ix.options.getBoolean('enabled', true);
        cfg.deleteMessages = enabled;
        saveData();
        return ix.reply({ content: `✅ Delete offending messages: **${enabled ? 'enabled' : 'disabled'}**`, flags: 64 });
      }
      if (sub === 'set-timeout') {
        const secs = ix.options.getInteger('seconds', true);
        cfg.timeoutSeconds = Math.max(10, Math.min(secs, 86400));
        saveData();
        return ix.reply({ content: `✅ Timeout set to **${cfg.timeoutSeconds} seconds**`, flags: 64 });
      }
      if (sub === 'set-logs') {
        const channel = ix.options.getChannel('channel', true);
        cfg.logsChannelId = channel.id;
        saveData();
        return ix.reply({ content: `✅ Logs channel set to ${channel}`, flags: 64 });
      }
    }

    if (ix.commandName === 'warnings') {
      const sub = ix.options.getSubcommand();
      const user = ix.options.getUser('user', true);

      if (sub === 'show') {
        const count = getWarns(gid, user.id);
        return ix.reply({ content: `📒 Warns for ${user}: **${count}**`, flags: 64 });
      }
      if (sub === 'reset') {
        resetWarns(gid, user.id);
        return ix.reply({ content: `🧹 Warns reset for ${user}.`, flags: 64 });
      }
    }
  } catch (err) {
    console.error(err);
    if (!ix.replied) await ix.reply({ content: '⚠️ Something went wrong.', flags: 64 });
  }
});

async function processMessage(message) {
  try {
    if (!message.guild || message.author?.bot) return;
    const cfg = getGuildConfig(message.guild.id);

    const authorMember = await message.guild.members.fetch(message.author.id);
    if (authorHasBypass(authorMember, cfg.bypassRoleIds)) return;

    if (cfg.protectedRoleIds.length && mentionsProtectedMember(message, cfg.protectedRoleIds)) {
      await handleOffense(message, cfg);
    }
  } catch (err) {
    console.error('processMessage error:', err);
  }
}

client.on(Events.MessageCreate, processMessage);
client.on(Events.MessageUpdate, async (_old, nu) => {
  const m = nu.partial ? await nu.fetch().catch(() => null) : nu;
  if (m) await processMessage(m);
});

client.login(process.env.DISCORD_TOKEN);
