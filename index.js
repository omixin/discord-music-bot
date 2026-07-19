require('dotenv').config();
process.env.FFMPEG_PATH = require('ffmpeg-static');
const { Client, GatewayIntentBits, REST, Routes, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType, EmbedBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, StreamType } = require('@discordjs/voice');
const { spawn } = require('child_process');
const play = require('play-dl');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

const fs = require('fs');

function ensureDataDir() {
    if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data', { recursive: true });
    }
}

function getFavorites(userId) {
    ensureDataDir();
    const filePath = './data/favorites.json';
    if (!fs.existsSync(filePath)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return data[userId] || [];
    } catch (e) { return []; }
}

function saveFavorites(userId, list) {
    ensureDataDir();
    const filePath = './data/favorites.json';
    let data = {};
    if (fs.existsSync(filePath)) {
        try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
    }
    data[userId] = list;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

function getStats(guildId) {
    ensureDataDir();
    const filePath = './data/stats.json';
    if (!fs.existsSync(filePath)) return { totalPlays: 0, tracks: {} };
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return data[guildId] || { totalPlays: 0, tracks: {} };
    } catch (e) { return { totalPlays: 0, tracks: {} }; }
}

function recordStat(guildId, track) {
    if (!guildId || !track) return;
    ensureDataDir();
    const filePath = './data/stats.json';
    let data = {};
    if (fs.existsSync(filePath)) {
        try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
    }
    if (!data[guildId]) data[guildId] = { totalPlays: 0, tracks: {} };
    data[guildId].totalPlays = (data[guildId].totalPlays || 0) + 1;
    const titleKey = track.title || 'Unknown Track';
    if (!data[guildId].tracks[titleKey]) {
        data[guildId].tracks[titleKey] = { count: 0, url: track.url || '' };
    }
    data[guildId].tracks[titleKey].count += 1;
    if (track.url) data[guildId].tracks[titleKey].url = track.url;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

// Глобальный объект для хранения очередей (Queue) для каждого сервера
const queues = new Map();

// Определение команд
const commands = [
    {
        name: 'play',
        description: 'Включить музыку',
        options: [
            {
                name: 'query',
                type: 3, // STRING
                description: 'Название песни или ссылка',
                required: true,
            },
        ],
    },
    { name: 'stop', description: 'Остановить музыку и очистить очередь' },
    { name: 'pause', description: 'Поставить музыку на паузу' },
    { name: 'resume', description: 'Снять музыку с паузы' },
    { name: 'skip', description: 'Пропустить текущий трек' },
    { name: 'queue', description: 'Показать текущую очередь' },
    {
        name: 'repeat',
        description: 'Включить повтор текущего трека (или выключить)',
        options: [
            {
                name: 'count',
                type: 4, // INTEGER
                description: 'Количество повторов (0 - выключить, пусто - бесконечно/переключатель)',
                required: false,
            },
        ],
    },
    {
        name: 'filter',
        description: 'Включить аудио-эффект (Slowed & Reverb, Bassboost, Nightcore)',
        options: [
            {
                name: 'effect',
                type: 3, // STRING
                description: 'Выбери аудио-эффект',
                required: true,
                choices: [
                    { name: '🌌 Slowed & Reverb', value: 'slowed' },
                    { name: '🔊 Bassboost', value: 'bassboost' },
                    { name: '⚡ Nightcore', value: 'nightcore' },
                    { name: '⏹️ Выключить (Обычный звук)', value: 'off' }
                ]
            }
        ]
    },
    {
        name: 'fav',
        description: 'Избранные треки: открыть список избранного или добавить трек (/fav [query])',
        options: [
            {
                name: 'query',
                type: 3, // STRING
                description: 'Название песни или ссылка для добавления в избранное',
                required: false,
            }
        ]
    },
    { name: 'stats', description: 'Показать топ-5 самых популярных треков сервера и статистику' }
];

client.once('ready', async () => {
    console.log(`✅ Бот ${client.user.tag} успешно запущен и работает на новом движке play-dl!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        for (const [guildId, guild] of client.guilds.cache) {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands }).catch(() => {});
        }
        console.log('Слэш-команды успешно зарегистрированы (глобально и мгновенно на всех серверах)!');
    } catch (error) {
        console.error('Ошибка при регистрации команд:', error);
    }
});

client.on('interactionCreate', async interaction => {
    // 1. Обработка всплывающих окон (Modals)
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_add_track') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const query = interaction.fields.getTextInputValue('query_input');
            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) {
                return interaction.editReply({ content: '❌ Вы должны находиться в голосовом канале!' });
            }
            return handleSearchAndAddTrack(interaction, query, voiceChannel);
        }
        if (interaction.customId.startsWith('fav_delete_submit_')) {
            const userId = interaction.customId.replace('fav_delete_submit_', '');
            if (interaction.user.id !== userId) {
                return interaction.reply({ content: '❌ Вы можете управлять только своим списком избранного!', flags: MessageFlags.Ephemeral });
            }
            const numStr = interaction.fields.getTextInputValue('track_num_input').trim();
            const num = parseInt(numStr, 10);
            const list = getFavorites(userId);
            if (isNaN(num) || num < 1 || num > list.length) {
                return interaction.reply({ content: `❌ Неверный номер трека! Введите число от 1 до ${list.length}.`, flags: MessageFlags.Ephemeral });
            }
            const removed = list.splice(num - 1, 1)[0];
            saveFavorites(userId, list);
            await interaction.reply({ content: `🗑️ Трек **${removed.title}** удалён из вашего избранного!`, flags: MessageFlags.Ephemeral });
            return;
        }
        return;
    }

    // 2. Обработка нажатий кнопок
    if (interaction.isButton()) {
        const { customId } = interaction;

        if (customId.startsWith('fav_')) {
            const parts = customId.split('_');
            if (parts[1] === 'page') {
                const userId = parts[2];
                const page = parseInt(parts[3], 10);
                if (interaction.user.id !== userId) {
                    return interaction.reply({ content: '❌ Вы можете управлять только своим списком избранного!', flags: MessageFlags.Ephemeral });
                }
                return interaction.update(createFavoritesPayload(userId, page));
            }
            if (parts[1] === 'delete' && parts[2] === 'modal') {
                const userId = parts[3];
                if (interaction.user.id !== userId) {
                    return interaction.reply({ content: '❌ Вы можете управлять только своим списком избранного!', flags: MessageFlags.Ephemeral });
                }
                const list = getFavorites(userId);
                const modal = new ModalBuilder()
                    .setCustomId(`fav_delete_submit_${userId}`)
                    .setTitle('🗑️ Удаление из избранного');
                const numInput = new TextInputBuilder()
                    .setCustomId('track_num_input')
                    .setLabel(`Номер трека (от 1 до ${list.length}):`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Например: 1')
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(numInput));
                return interaction.showModal(modal);
            }
            if (parts[1] === 'add' && parts[2] === 'current') {
                const userId = parts[3];
                if (interaction.user.id !== userId) {
                    return interaction.reply({ content: '❌ Это не ваш список избранного!', flags: MessageFlags.Ephemeral });
                }
                const queue = queues.get(interaction.guildId);
                if (!queue || !queue.current) {
                    return interaction.reply({ content: '❌ Сейчас ничего не играет на сервере!', flags: MessageFlags.Ephemeral });
                }
                const list = getFavorites(userId);
                const already = list.some(t => (t.url && t.url === queue.current.url) || (t.title === queue.current.title));
                if (already) {
                    return interaction.reply({ content: '⚠️ Этот трек уже есть в вашем списке избранного!', flags: MessageFlags.Ephemeral });
                }
                list.push({
                    title: queue.current.title,
                    url: queue.current.url,
                    durationRaw: queue.current.durationRaw || formatTime(queue.current.durationInSec)
                });
                saveFavorites(userId, list);
                await interaction.reply({ content: `⭐ **${queue.current.title}** сохранён в ваше избранное!`, flags: MessageFlags.Ephemeral });
                return interaction.message.edit(createFavoritesPayload(userId, 1)).catch(() => {});
            }
            if (parts[1] === 'play') {
                const userId = parts[2];
                const index = parseInt(parts[3], 10);
                if (interaction.user.id !== userId) {
                    return interaction.reply({ content: '❌ Это не ваш список избранного!', flags: MessageFlags.Ephemeral });
                }
                const list = getFavorites(userId);
                const favTrack = list[index];
                if (!favTrack) {
                    return interaction.reply({ content: '❌ Трек не найден в списке!', flags: MessageFlags.Ephemeral });
                }
                const voiceChannel = interaction.member?.voice?.channel;
                if (!voiceChannel) {
                    return interaction.reply({ content: '❌ Вы должны находиться в голосовом канале!', flags: MessageFlags.Ephemeral });
                }
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                return handleSearchAndAddTrack(interaction, favTrack.url || favTrack.title, voiceChannel);
            }
            return;
        }

        const queue = queues.get(interaction.guildId);
        if (!queue || (!queue.current && interaction.customId !== 'ctrl_add_track')) {
            return interaction.reply({ content: '❌ Сейчас ничего не играет.', flags: MessageFlags.Ephemeral });
        }

        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Вы должны находиться в голосовом канале с ботом!', flags: MessageFlags.Ephemeral });
        }

        if (customId === 'repeat_minus') {
            if (queue.repeatMode && queue.repeatCount > 1 && queue.repeatCount !== Infinity) {
                queue.repeatCount--;
            } else if (queue.repeatCount === 1 || queue.repeatCount === Infinity) {
                queue.repeatMode = false;
                queue.repeatCount = 0;
            }
            return interaction.update(createRepeatPayload(queue));
        }

        if (customId === 'repeat_off') {
            queue.repeatMode = false;
            queue.repeatCount = 0;
            return interaction.update(createRepeatPayload(queue));
        }

        if (customId === 'repeat_plus') {
            if (!queue.repeatMode || queue.repeatCount === 0) {
                queue.repeatMode = true;
                queue.repeatCount = 1;
            } else if (queue.repeatCount === Infinity) {
                queue.repeatCount = 1;
            } else {
                queue.repeatCount++;
            }
            return interaction.update(createRepeatPayload(queue));
        }

        if (customId === 'ctrl_pause_resume') {
            const isPaused = queue.player.state.status === AudioPlayerStatus.Paused;
            if (isPaused) {
                queue.player.unpause();
            } else {
                queue.player.pause();
            }
            return interaction.update(createPlayerPayload(queue));
        }

        if (customId === 'ctrl_skip') {
            queue.repeatMode = false;
            queue.repeatCount = 0;
            queue.player.stop();
            return interaction.reply({ content: '⏭️ Трек пропущен.', flags: MessageFlags.Ephemeral });
        }

        if (customId === 'ctrl_stop') {
            if (queue.progressInterval) clearInterval(queue.progressInterval);
            if (queue.idleInterval) clearInterval(queue.idleInterval);
            if (queue.idleTimeout) clearTimeout(queue.idleTimeout);
            if (queue.nowPlayingMessage) queue.nowPlayingMessage.delete().catch(() => {});
            queue.tracks = [];
            queue.player.stop();
            queue.connection.destroy();
            queues.delete(interaction.guildId);
            return interaction.update({ content: '🛑 Музыка остановлена, очередь очищена.', embeds: [], components: [] });
        }

        if (customId === 'ctrl_add_track') {
            const list = getFavorites(interaction.user.id);
            if (list.length === 0) {
                const modal = new ModalBuilder()
                    .setCustomId('modal_add_track')
                    .setTitle('Добавление трека в очередь');

                const queryInput = new TextInputBuilder()
                    .setCustomId('query_input')
                    .setLabel('Введите название песни или ссылку:')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Например: Linkin Park Numb или ссылка YouTube')
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
                return interaction.showModal(modal);
            } else {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('ctrl_add_choice_modal')
                        .setLabel('🔍 Найти по названию / ссылке')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('ctrl_add_choice_favs')
                        .setLabel(`⭐ Моё избранное (${list.length} шт.)`)
                        .setStyle(ButtonStyle.Success)
                );
                return interaction.reply({
                    content: '🎵 **Откуда вы хотите добавить трек в очередь?**\nУ вас есть сохранённые треки в избранном. Выберите способ:',
                    components: [row],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        if (customId === 'ctrl_add_choice_modal') {
            const modal = new ModalBuilder()
                .setCustomId('modal_add_track')
                .setTitle('Добавление трека в очередь');

            const queryInput = new TextInputBuilder()
                .setCustomId('query_input')
                .setLabel('Введите название песни или ссылку:')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Например: Linkin Park Numb или ссылка YouTube')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
            return interaction.showModal(modal);
        }

        if (customId === 'ctrl_add_choice_favs') {
            const list = getFavorites(interaction.user.id);
            if (list.length === 0) {
                return interaction.update({ content: '❌ Ваш список избранного пуст!', components: [] });
            }
            const select = new StringSelectMenuBuilder()
                .setCustomId('select_add_from_favs')
                .setPlaceholder('⭐ Выберите трек из вашего избранного:')
                .addOptions(
                    list.slice(0, 25).map((track, i) =>
                        new StringSelectMenuOptionBuilder()
                            .setLabel(track.title.substring(0, 95))
                            .setDescription(`⏱️ ${track.durationRaw || '?:??'} | Ссылка: ${(track.url || 'Поиск').substring(0, 60)}`)
                            .setValue(i.toString())
                    )
                );
            const row = new ActionRowBuilder().addComponents(select);
            return interaction.update({
                content: '⭐ **Ваше избранное:**\nВыберите трек из списка ниже, чтобы мгновенно добавить его в очередь:',
                components: [row]
            });
        }

        if (customId === 'ctrl_repeat') {
            return interaction.reply({ ...createRepeatPayload(queue), flags: MessageFlags.Ephemeral });
        }

        if (customId === 'ctrl_effects') {
            const select = new StringSelectMenuBuilder()
                .setCustomId('select_effects')
                .setPlaceholder('🎚️ Выберите аудио-эффект:')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('🌌 Slowed & Reverb').setValue('slowed').setDescription('Замедление с глубоким эхо'),
                    new StringSelectMenuOptionBuilder().setLabel('🔊 Bassboost').setValue('bassboost').setDescription('Усиление низких частот (Басс)'),
                    new StringSelectMenuOptionBuilder().setLabel('⚡ Nightcore').setValue('nightcore').setDescription('Ускорение и высокий питч'),
                    new StringSelectMenuOptionBuilder().setLabel('⏹️ Выключить (Обычный звук)').setValue('off').setDescription('Сбросить эффекты к оригиналу')
                );
            const row = new ActionRowBuilder().addComponents(select);
            return interaction.reply({ content: '🎚️ **Управление аудио-эффектами:**\nВыберите эффект из списка ниже:', components: [row], flags: MessageFlags.Ephemeral });
        }

        return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_effects') {
        const queue = queues.get(interaction.guildId);
        if (!queue || !queue.current) {
            return interaction.reply({ content: '❌ Сейчас ничего не играет.', flags: MessageFlags.Ephemeral });
        }
        const effect = interaction.values[0];
        queue.filter = effect;
        const filterNames = {
            slowed: '🌌 Slowed & Reverb',
            bassboost: '🔊 Bassboost',
            nightcore: '⚡ Nightcore',
            off: '⏹️ Выключено (Обычный звук)'
        };
        const effectName = filterNames[effect] || effect;
        if (queue.player.state.status !== AudioPlayerStatus.Idle) {
            const elapsedSec = queue.current.startTime ? Math.floor((Date.now() - queue.current.startTime) / 1000) : 0;
            await playTrack(interaction.guildId, queue.current, elapsedSec);
            return interaction.update({ content: `🎚️ Применен эффект: **${effectName}** к текущему треку!`, components: [] });
        } else {
            return interaction.update({ content: `🎚️ Аудио-эффект установлен на: **${effectName}** (будет применен к следующему треку)`, components: [] });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_add_from_favs') {
        const list = getFavorites(interaction.user.id);
        const index = parseInt(interaction.values[0], 10);
        const track = list[index];
        if (!track) {
            return interaction.update({ content: '❌ Трек не найден в списке!', components: [] });
        }
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.update({ content: '❌ Вы должны находиться в голосовом канале с ботом!', components: [] });
        }
        await interaction.update({ content: `⏳ Добавляю в очередь трек из избранного: **${track.title}**...`, components: [] });
        return handleSearchAndAddTrack(interaction, track.url || track.title, voiceChannel);
    }

    // 3. Обработка слэш-команд
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
        return interaction.reply({ content: '❌ Вы должны находиться в голосовом канале!', flags: MessageFlags.Ephemeral });
    }

    let queue = queues.get(interaction.guildId);

    if (commandName === 'play') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const query = interaction.options.getString('query');
        return handleSearchAndAddTrack(interaction, query, voiceChannel);
    }

    if (commandName === 'stop') {
        if (!queue) return interaction.reply({ content: '❌ Сейчас ничего не играет.', flags: MessageFlags.Ephemeral });
        if (queue.progressInterval) clearInterval(queue.progressInterval);
        if (queue.idleInterval) clearInterval(queue.idleInterval);
        if (queue.idleTimeout) clearTimeout(queue.idleTimeout);
        if (queue.nowPlayingMessage) queue.nowPlayingMessage.delete().catch(() => {});
        queue.tracks = [];
        queue.player.stop();
        queue.connection.destroy();
        queues.delete(interaction.guildId);
        return interaction.reply({ content: '🛑 Музыка остановлена, очередь очищена.', flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'pause') {
        if (!queue) return interaction.reply({ content: '❌ Сейчас ничего не играет.', flags: MessageFlags.Ephemeral });
        queue.player.pause();
        updatePlayerEmbed(queue);
        return interaction.reply({ content: '⏸️ Музыка поставлена на паузу.', flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'resume') {
        if (!queue) return interaction.reply({ content: '❌ Сейчас ничего не играет.', flags: MessageFlags.Ephemeral });
        queue.player.unpause();
        updatePlayerEmbed(queue);
        return interaction.reply({ content: '▶️ Музыка снята с паузы.', flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'skip') {
        if (!queue || !queue.current) return interaction.reply({ content: '❌ Сейчас ничего не играет.', flags: MessageFlags.Ephemeral });
        queue.repeatMode = false;
        queue.repeatCount = 0;
        queue.player.stop();
        return interaction.reply({ content: '⏭️ Трек пропущен.', flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'queue') {
        if (!queue) return interaction.reply({ content: '❌ Сейчас ничего не играет.', flags: MessageFlags.Ephemeral });
        return interaction.reply({ content: formatQueueString(queue), flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'repeat') {
        if (!queue || !queue.current) return interaction.reply({ content: '❌ Сейчас ничего не играет.', flags: MessageFlags.Ephemeral });
        const count = interaction.options.getInteger('count');

        if (count === null) {
            if (queue.repeatMode) {
                queue.repeatMode = false;
                queue.repeatCount = 0;
            } else {
                queue.repeatMode = true;
                queue.repeatCount = Infinity;
            }
        } else if (count <= 0) {
            queue.repeatMode = false;
            queue.repeatCount = 0;
        } else {
            queue.repeatMode = true;
            queue.repeatCount = count;
        }

        updatePlayerEmbed(queue);
        return interaction.reply({ ...createRepeatPayload(queue), flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'filter') {
        if (!queue || !queue.current) return interaction.reply({ content: '❌ Сейчас ничего не играет.', flags: MessageFlags.Ephemeral });
        const effect = interaction.options.getString('effect');
        queue.filter = effect;

        const filterNames = {
            slowed: '🌌 Slowed & Reverb',
            bassboost: '🔊 Bassboost',
            nightcore: '⚡ Nightcore',
            off: '⏹️ Выключено (Обычный звук)'
        };
        const effectName = filterNames[effect] || effect;

        if (queue.player.state.status !== AudioPlayerStatus.Idle) {
            const elapsedSec = queue.current.startTime ? Math.floor((Date.now() - queue.current.startTime) / 1000) : 0;
            await playTrack(interaction.guildId, queue.current, elapsedSec);
            return interaction.reply({ content: `🎚️ Применен эффект: **${effectName}** к текущему треку!`, flags: MessageFlags.Ephemeral });
        } else {
            return interaction.reply({ content: `🎚️ Аудио-эффект установлен на: **${effectName}** (будет применен к следующему треку)`, flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === 'fav') {
        const query = interaction.options.getString('query');
        const userId = interaction.user.id;
        if (query && query.trim() !== '') {
            const list = getFavorites(userId);
            const already = list.some(t => t.title.toLowerCase() === query.toLowerCase() || (t.url && t.url === query));
            if (already) {
                return interaction.reply({ content: '⚠️ Этот трек уже есть в вашем избранном!', flags: MessageFlags.Ephemeral });
            }
            list.push({
                title: query,
                url: query.startsWith('http') ? query : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
                durationRaw: '?:??'
            });
            saveFavorites(userId, list);
            return interaction.reply({ content: `⭐ **${query}** добавлен в ваше избранное! Используйте \`/fav\` для просмотра.`, flags: MessageFlags.Ephemeral });
        } else {
            return interaction.reply({ ...createFavoritesPayload(userId, 1), flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === 'stats') {
        return interaction.reply({ ...createStatsPayload(interaction.guildId), flags: MessageFlags.Ephemeral });
    }
});

async function handleSearchAndAddTrack(interaction, query, voiceChannel) {
    let queue = queues.get(interaction.guildId);
    try {
        let selectedTrack = null;

        if (query.startsWith('http')) {
            const info = await play.video_info(query);
            selectedTrack = {
                title: info.video_details.title,
                url: info.video_details.url,
                durationInSec: info.video_details.durationInSec || 0,
                durationRaw: info.video_details.durationRaw || '?:??',
                channel: { name: info.video_details.channel?.name || 'YouTube' },
                thumbnail: info.video_details.thumbnails?.[0]?.url || null,
                source: 'YouTube',
                requester: interaction.user
            };
        } else {
            const searchResults = await play.search(query, { limit: 5 });
            if (!searchResults || searchResults.length === 0) {
                return interaction.editReply({ content: '❌ Ничего не найдено!' });
            }

            const select = new StringSelectMenuBuilder()
                .setCustomId('track_select')
                .setPlaceholder('Выберите трек для добавления')
                .addOptions(
                    searchResults.map((track, i) => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(track.title.substring(0, 95))
                            .setDescription(`⏱️ ${track.durationRaw || '?:??'} | 👤 ${(track.channel?.name || 'Неизвестный автор').substring(0, 65)}`)
                            .setValue(i.toString())
                            .setEmoji(getEmoji('youtube'))
                    )
                );

            const row = new ActionRowBuilder().addComponents(select);
            const response = await interaction.followUp({
                content: '🔍 Найдено несколько вариантов. Выберите один из них (у вас есть 1 минута):',
                components: [row],
                flags: MessageFlags.Ephemeral
            });

            const confirmation = await response.awaitMessageComponent({ 
                filter: i => i.user.id === interaction.user.id,
                time: 60000, 
                componentType: ComponentType.StringSelect 
            });

            const chosen = searchResults[parseInt(confirmation.values[0])];
            selectedTrack = {
                title: chosen.title,
                url: chosen.url,
                durationInSec: chosen.durationInSec || 0,
                durationRaw: chosen.durationRaw || '?:??',
                channel: { name: chosen.channel?.name || 'YouTube' },
                thumbnail: chosen.thumbnails?.[0]?.url || null,
                source: 'YouTube',
                requester: interaction.user
            };
            console.log('Выбранный трек:', selectedTrack);
            
            await confirmation.update({ content: `⏳ Добавляю в очередь: **${selectedTrack.title}**...`, components: [] });
        }

        if (!queue) {
            const player = createAudioPlayer();
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guildId,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });

            queue = {
                connection,
                player,
                tracks: [],
                current: null,
                repeatMode: false,
                repeatCount: 0,
                filter: 'off',
                textChannel: interaction.channel,
                nowPlayingMessage: null,
                progressInterval: null,
                idleInterval: null,
                idleTimeout: null,
                subprocess: null,
                ffmpegProcess: null
            };
            
            connection.subscribe(player);
            queues.set(interaction.guildId, queue);

            connection.on('error', error => {
                console.error('⚠️ Ошибка соединения VoiceConnection (игнорируем/восстанавливаем):', error.message || error);
            });

            player.on('error', error => {
                console.error('⚠️ Ошибка аудио-плеера (пропускаем трек):', error.message || error);
                if (queue && queue.current) {
                    queue.current = null;
                    const nextTrack = queue.tracks.shift();
                    if (nextTrack) playTrack(interaction.guildId, nextTrack);
                }
            });

            player.on(AudioPlayerStatus.Playing, () => {
                if (queue && queue.current) {
                    if (!queue.current.hasStartedPlaying) {
                        queue.current.hasStartedPlaying = true;
                        queue.current.startTime = Date.now() - ((queue.current.seekSeconds || 0) * 1000);
                    } else if (queue.current.pausedAt && queue.current.startTime) {
                        const pauseDuration = Date.now() - queue.current.pausedAt;
                        queue.current.startTime += pauseDuration;
                        queue.current.pausedAt = null;
                    }
                    updatePlayerEmbed(queue);
                }
            });

            player.on(AudioPlayerStatus.Paused, () => {
                if (queue && queue.current && !queue.current.pausedAt) {
                    queue.current.pausedAt = Date.now();
                    updatePlayerEmbed(queue);
                }
            });

            player.on(AudioPlayerStatus.Idle, () => {
                if (queue.ffmpegProcess) {
                    try { queue.ffmpegProcess.kill(); } catch (e) {}
                    queue.ffmpegProcess = null;
                }
                if (queue.subprocess) {
                    try { queue.subprocess.kill(); } catch (e) {}
                    queue.subprocess = null;
                }
                if (queue.progressInterval) {
                    clearInterval(queue.progressInterval);
                    queue.progressInterval = null;
                }

                if (queue.repeatMode && queue.current && queue.repeatCount !== 0) {
                    if (queue.repeatCount !== Infinity && queue.repeatCount > 0) {
                        queue.repeatCount--;
                        if (queue.repeatCount === 0) {
                            queue.repeatMode = false;
                        }
                    }
                    playTrack(interaction.guildId, queue.current);
                } else {
                    queue.current = null;
                    const nextTrack = queue.tracks.shift();
                    if (nextTrack) {
                        playTrack(interaction.guildId, nextTrack);
                    } else {
                        startIdleTimer(interaction.guildId, queue);
                    }
                }
            });

            connection.on(VoiceConnectionStatus.Disconnected, () => {
                if (queue.progressInterval) clearInterval(queue.progressInterval);
                if (queue.idleInterval) clearInterval(queue.idleInterval);
                if (queue.idleTimeout) clearTimeout(queue.idleTimeout);
                if (queue.nowPlayingMessage) queue.nowPlayingMessage.delete().catch(() => {});
                try { connection.destroy(); } catch (e) {}
                queues.delete(interaction.guildId);
            });
        } else {
            if (interaction.channel) {
                queue.textChannel = interaction.channel;
            }
            if (queue.idleTimeout) { clearTimeout(queue.idleTimeout); queue.idleTimeout = null; }
            if (queue.idleInterval) { clearInterval(queue.idleInterval); queue.idleInterval = null; }
        }

        queue.tracks.push(selectedTrack);
        
        if (queue.player.state.status === AudioPlayerStatus.Idle && queue.current === null) {
            const nextTrack = queue.tracks.shift();
            await playTrack(interaction.guildId, nextTrack);
            return interaction.editReply({ content: `${getEmojiText('music')} Начинаю воспроизведение: **${selectedTrack.title}**` });
        } else {
            await interaction.editReply({ content: `${getEmojiText('music')} **${selectedTrack.title}** отправлен в очередь!` });
            
            if (queue.textChannel) {
                const miniEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setAuthor({ 
                        name: `Запросил(а): ${selectedTrack.requester?.displayName || selectedTrack.requester?.username || 'Пользователь'}`, 
                        iconURL: selectedTrack.requester?.displayAvatarURL() || null 
                    })
                    .setDescription(`${getEmojiText('music')} **[${selectedTrack.title}](${selectedTrack.url})** добавлен в очередь!`);
                
                queue.textChannel.send({ embeds: [miniEmbed] }).then(msg => {
                    setTimeout(() => {
                        msg.delete().catch(() => {});
                    }, 10000);
                }).catch(() => {});
            }
            return;
        }

    } catch (e) {
        console.error(e);
        if (e.code === 'InteractionCollectorError') {
            return interaction.editReply({ content: '❌ Вы не выбрали трек вовремя.', components: [] });
        }
        return interaction.editReply({ content: `❌ Произошла ошибка. Попробуйте еще раз.`, components: [] });
    }
}

function formatQueueString(queue) {
    const repeatStatus = queue.repeatMode ? (queue.repeatCount === Infinity ? ' 🔂 [Повтор: ∞]' : ` 🔂 [Повтор: осталось ${queue.repeatCount} раз(а)]`) : '';
    let queueString = queue.current ? `**Сейчас играет:** ${queue.current.title}${repeatStatus}\n\n**Очередь:**\n` : '**Очередь:**\n';
    
    if (queue.tracks.length === 0) {
        queueString += '*Очередь пуста*';
    } else {
        queueString += queue.tracks.map((t, i) => `${i + 1}. ${t.title}`).slice(0, 10).join('\n');
        if (queue.tracks.length > 10) queueString += `\n...и еще ${queue.tracks.length - 10} треков`;
    }
    return queueString;
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

let configData = { useCustomEmojis: true, emojis: {} };
try {
    configData = require('./config.json');
} catch (e) {
    console.log('💡 config.json не найден, используются стандартные смайлики.');
}

const CUSTOM_EMOJIS = configData.useCustomEmojis ? (configData.emojis || {}) : {};

const DEFAULT_UNICODE = {
    play: '▶️',
    pause: '⏸️',
    skip: '⏭️',
    repeat: '🔁',
    repeat_single: '🔂',
    plus: '➕',
    minus: '➖',
    slider: '🔘',
    queue: '📋',
    music: '🎵',
    youtube: '🔴'
};

function getEmoji(key) {
    const customId = CUSTOM_EMOJIS[key];
    return customId && customId.trim() !== '' ? customId : (DEFAULT_UNICODE[key] || '');
}

function getEmojiText(key) {
    const customId = CUSTOM_EMOJIS[key];
    if (customId && customId.trim() !== '') {
        return `<:${key}:${customId}>`;
    }
    return DEFAULT_UNICODE[key] || '';
}

function createProgressBar(elapsedSec, totalSec, isBuffering = false) {
    const sliderText = getEmojiText('slider');
    if (isBuffering) {
        return `⌛ **Загрузка и буферизация аудио...** [ 0:00 / ${formatTime(totalSec)} ]`;
    }
    const safeElapsed = totalSec > 0 ? Math.min(Math.max(0, elapsedSec), totalSec) : Math.max(0, elapsedSec);
    if (!totalSec || totalSec <= 0) {
        return `${sliderText} ▬ ▬ ▬ ▬ ▬ ▬ ▬ ▬ ▬ [ ${formatTime(safeElapsed)} / ?:?? ]`;
    }
    const progress = Math.min(Math.floor((safeElapsed / totalSec) * 10), 9);
    let bar = '';
    for (let i = 0; i < 10; i++) {
        if (i === progress) bar += sliderText;
        else bar += '▬';
    }
    return `${bar} [ ${formatTime(safeElapsed)} / ${formatTime(totalSec)} ]`;
}

function createIdlePayload(secondsLeft) {
    const embed = new EmbedBuilder()
        .setColor(0xFFA500)
        .setTitle('⏸️ Очередь воспроизведения закончилась!')
        .setDescription(`⚠️ Панель плеера будет автоматически удалена через **${secondsLeft} сек.**, если не добавить новый трек! (Бот останется в голосовом канале)`)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ctrl_add_track')
            .setLabel('Добавить трек')
            .setEmoji(getEmoji('plus'))
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

function startIdleTimer(guildId, queue) {
    if (queue.progressInterval) {
        clearInterval(queue.progressInterval);
        queue.progressInterval = null;
    }
    if (queue.idleTimeout) { clearTimeout(queue.idleTimeout); queue.idleTimeout = null; }
    if (queue.idleInterval) { clearInterval(queue.idleInterval); queue.idleInterval = null; }

    let secondsLeft = 60;
    if (queue.nowPlayingMessage) {
        queue.nowPlayingMessage.edit(createIdlePayload(secondsLeft)).catch(() => {});
    } else if (queue.textChannel) {
        queue.textChannel.send(createIdlePayload(secondsLeft)).then(msg => {
            queue.nowPlayingMessage = msg;
        }).catch(() => {});
    }

    queue.idleInterval = setInterval(() => {
        secondsLeft -= 10;
        if (secondsLeft > 0 && queue.nowPlayingMessage) {
            queue.nowPlayingMessage.edit(createIdlePayload(secondsLeft)).catch(() => {});
        }
    }, 10000);

    queue.idleTimeout = setTimeout(() => {
        if (queue.idleInterval) { clearInterval(queue.idleInterval); queue.idleInterval = null; }
        if (queue.nowPlayingMessage) {
            queue.nowPlayingMessage.delete().catch(() => {});
            queue.nowPlayingMessage = null;
        }
        console.log(`🛑 Панель плеера удалена по таймауту (60 сек без активности на сервере ${guildId}). Бот остаётся в голосовом канале.`);
    }, 60000);
}

function createPlayerPayload(queue) {
    const isPaused = queue.player.state.status === AudioPlayerStatus.Paused;
    const isBuffering = Boolean(queue.current && !queue.current.hasStartedPlaying && !isPaused);
    const totalSec = queue.current?.durationInSec || 0;

    let rawElapsed = 0;
    if (queue.current) {
        if (!queue.current.hasStartedPlaying) {
            rawElapsed = queue.current.seekSeconds || 0;
        } else if (queue.current.pausedAt && queue.current.startTime) {
            rawElapsed = Math.floor((queue.current.pausedAt - queue.current.startTime) / 1000);
        } else if (queue.current.startTime) {
            rawElapsed = Math.floor((Date.now() - queue.current.startTime) / 1000);
        }
    }
    const elapsedSec = totalSec > 0 ? Math.min(Math.max(0, rawElapsed), totalSec) : Math.max(0, rawElapsed);

    const filterNames = {
        slowed: '🌌 Slowed & Reverb',
        bassboost: '🔊 Bassboost',
        nightcore: '⚡ Nightcore',
        off: 'Выключен'
    };
    const filterText = filterNames[queue.filter] || 'Выключен';
    const repeatText = queue.repeatMode ? (queue.repeatCount === Infinity ? 'Бесконечно' : `${queue.repeatCount} раз(а)`) : 'Выключен';
    const repeatIcon = queue.repeatMode ? (queue.repeatCount === Infinity ? getEmojiText('repeat') : getEmojiText('repeat_single')) : getEmojiText('repeat');

    const embed = new EmbedBuilder()
        .setColor(isBuffering ? 0xFFA500 : (isPaused ? 0xFFFF00 : 0xFF0000))
        .setTitle(queue.current?.title || 'Воспроизведение музыки')
        .setURL(queue.current?.url || null)
        .setDescription(`**Прогресс:**\n${createProgressBar(elapsedSec, totalSec, isBuffering)}\n\n${repeatIcon} **Повтор:** ${repeatText} | 🎚️ **Эффект:** ${filterText}`)
        .setTimestamp();

    const requester = queue.current?.requester;
    if (requester) {
        embed.setAuthor({ 
            name: `Запросил(а): ${requester.displayName || requester.username || 'Пользователь'}`, 
            iconURL: requester.displayAvatarURL() || null 
        });
    } else {
        embed.setAuthor({ name: queue.current?.channel?.name || 'YouTube' });
    }

    if (queue.current?.thumbnail) {
        embed.setThumbnail(queue.current.thumbnail);
    }

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ctrl_pause_resume')
            .setLabel(isPaused ? 'Продолжить' : 'Пауза')
            .setEmoji(isPaused ? getEmoji('play') : getEmoji('pause'))
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('ctrl_skip')
            .setLabel('Пропустить')
            .setEmoji(getEmoji('skip'))
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('ctrl_stop')
            .setLabel('⏹️ Стоп')
            .setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ctrl_add_track')
            .setLabel('Добавить трек')
            .setEmoji(getEmoji('plus'))
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('ctrl_repeat')
            .setLabel('Повтор')
            .setEmoji(queue.repeatMode && queue.repeatCount !== Infinity ? getEmoji('repeat_single') : getEmoji('repeat'))
            .setStyle(queue.repeatMode ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('ctrl_effects')
            .setLabel('🎚️ Эффекты')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row1, row2] };
}

function createRepeatPayload(queue) {
    const repeatIcon = queue.repeatMode ? (queue.repeatCount === Infinity ? getEmojiText('repeat') : getEmojiText('repeat_single')) : getEmojiText('repeat');
    const statusText = !queue.repeatMode 
        ? `${repeatIcon} **Повтор трека выключен.**`
        : (queue.repeatCount === Infinity 
            ? `${repeatIcon} **Повтор текущего трека:** Бесконечно` 
            : `${repeatIcon} **Повтор текущего трека:** осталось **${queue.repeatCount}** раз(а)`);

    const embed = new EmbedBuilder()
        .setColor(queue.repeatMode ? 0x00FF00 : 0x808080)
        .setDescription(statusText);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('repeat_minus')
            .setLabel('-1 повтор')
            .setEmoji(getEmoji('minus'))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!queue.repeatMode || queue.repeatCount === Infinity),
        new ButtonBuilder()
            .setCustomId('repeat_off')
            .setLabel('⏹️ Выключить')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!queue.repeatMode),
        new ButtonBuilder()
            .setCustomId('repeat_plus')
            .setLabel('+1 повтор')
            .setEmoji(getEmoji('plus'))
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

function createFavoritesPayload(userId, page = 1) {
    const list = getFavorites(userId);
    const totalPages = Math.max(1, Math.ceil(list.length / 5));
    page = Math.min(Math.max(1, page), totalPages);

    const startIndex = (page - 1) * 5;
    const pageTracks = list.slice(startIndex, startIndex + 5);

    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`⭐ Избранные треки (Страница ${page} из ${totalPages})`)
        .setTimestamp();

    if (list.length === 0) {
        embed.setDescription('*Ваш список избранного пока пуст!*\n💡 Чтобы добавить трек, используйте `/fav [название/ссылка]` или нажмите **`⭐ + Текущий`** при воспроизведении музыки.');
    } else {
        const descText = pageTracks.map((t, i) => `**${startIndex + i + 1}.** [${t.title}](${t.url}) \`[${t.durationRaw || '?:??'}]\``).join('\n\n');
        embed.setDescription(descText);
    }

    const row1 = new ActionRowBuilder();
    for (let i = 0; i < pageTracks.length; i++) {
        row1.addComponents(
            new ButtonBuilder()
                .setCustomId(`fav_play_${userId}_${startIndex + i}`)
                .setLabel(`${i + 1}`)
                .setStyle(ButtonStyle.Primary)
        );
    }

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`fav_page_${userId}_${page - 1}`)
            .setLabel('◀️ Пред.')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 1),
        new ButtonBuilder()
            .setCustomId(`fav_delete_modal_${userId}`)
            .setLabel('🗑️ Удалить')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(list.length === 0),
        new ButtonBuilder()
            .setCustomId(`fav_page_${userId}_${page + 1}`)
            .setLabel('▶️ След.')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages),
        new ButtonBuilder()
            .setCustomId(`fav_add_current_${userId}`)
            .setLabel('⭐ + Текущий')
            .setStyle(ButtonStyle.Success)
    );

    const components = row1.components.length > 0 ? [row1, row2] : [row2];
    return { embeds: [embed], components };
}

function createStatsPayload(guildId) {
    const stats = getStats(guildId);
    const sorted = Object.entries(stats.tracks || {})
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5);

    const embed = new EmbedBuilder()
        .setColor(0x00FFFF)
        .setTitle('📊 Статистика музыкального плеера на сервере')
        .setDescription(`🎧 **Всего прослушано треков:** ${stats.totalPlays || 0}\n\n🏆 **Топ-5 самых популярных треков:**\n` +
            (sorted.length > 0 
                ? sorted.map(([title, data], i) => {
                    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
                    const linkText = data.url ? `[${title}](${data.url})` : `**${title}**`;
                    return `${medals[i] || `${i+1}.`} ${linkText} — *${data.count} раз(а)*`;
                }).join('\n\n')
                : '*Пока на этом сервере не проиграно ни одного трека!*'))
        .setTimestamp();

    return { embeds: [embed] };
}

function updatePlayerEmbed(queue) {
    if (queue && queue.nowPlayingMessage) {
        queue.nowPlayingMessage.edit(createPlayerPayload(queue)).catch(() => {});
    }
}

async function playTrack(guildId, track, seekSeconds = 0) {
    const queue = queues.get(guildId);
    if (!queue || !track) return;
    try {
        if (queue.idleTimeout) { clearTimeout(queue.idleTimeout); queue.idleTimeout = null; }
        if (queue.idleInterval) { clearInterval(queue.idleInterval); queue.idleInterval = null; }

        queue.current = track;
        if (queue.current) {
            queue.current.hasStartedPlaying = false;
            queue.current.seekSeconds = seekSeconds;
            queue.current.pausedAt = null;
            queue.current.startTime = Date.now() - (seekSeconds * 1000);
        }
        
        if (queue.ffmpegProcess) {
            try { queue.ffmpegProcess.kill(); } catch (e) {}
            queue.ffmpegProcess = null;
        }
        if (queue.subprocess) {
            try { queue.subprocess.kill(); } catch (e) {}
            queue.subprocess = null;
        }
        
        const fs = require('fs');
        const path = require('path');
        const { exec } = require('youtube-dl-exec');
        
        const ytdlOptions = {
            o: '-',
            q: true,
            f: 'bestaudio/best/18',
            'js-runtimes': 'node',
            'extractor-args': 'youtube:player_client=default,android,ios,web,tv'
        };
        
        const cookiesPath = path.join(__dirname, 'cookies.txt');
        if (fs.existsSync(cookiesPath)) {
            ytdlOptions.cookies = cookiesPath;
        }

        const subprocess = exec(track.url, ytdlOptions, { stdio: ['ignore', 'pipe', 'ignore'] });

        subprocess.catch(err => {
            if (err && (err.signal === 'SIGTERM' || err.signal === 'SIGKILL' || err.code === 'ABORT_ERR')) return;
            if (err && err.message && (err.message.includes('SIGTERM') || err.message.includes('SIGPIPE') || err.message.includes('stdout closed'))) return;
            console.error('Ошибка в процессе yt-dlp:', err.message || err);
        });
        if (typeof subprocess.on === 'function') {
            subprocess.on('error', () => {});
        }
        if (subprocess.stdout && typeof subprocess.stdout.on === 'function') {
            subprocess.stdout.on('error', () => {});
        }

        queue.subprocess = subprocess;

        let resource;
        if (queue.filter === 'off' && seekSeconds === 0) {
            resource = createAudioResource(subprocess.stdout);
        } else {
            const ffmpegArgs = [
                '-i', 'pipe:0',
                '-analyzeduration', '0',
                '-loglevel', '0'
            ];
            if (seekSeconds && seekSeconds > 0) {
                ffmpegArgs.unshift('-ss', `${seekSeconds}`);
            }
            if (queue.filter === 'slowed') {
                ffmpegArgs.push('-af', 'asetrate=44100*0.85,aresample=44100,aecho=0.8:0.8:60:0.4');
            } else if (queue.filter === 'bassboost') {
                ffmpegArgs.push('-af', 'bass=g=15,dynaudnorm=f=200');
            } else if (queue.filter === 'nightcore') {
                ffmpegArgs.push('-af', 'asetrate=44100*1.25,aresample=44100');
            }
            ffmpegArgs.push('-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1');

            const ffmpegProcess = spawn(process.env.FFMPEG_PATH, ffmpegArgs, { stdio: ['pipe', 'pipe', 'ignore'] });
            ffmpegProcess.on('error', () => {});
            if (ffmpegProcess.stdin) ffmpegProcess.stdin.on('error', () => {});
            if (ffmpegProcess.stdout) ffmpegProcess.stdout.on('error', () => {});
            queue.ffmpegProcess = ffmpegProcess;

            subprocess.stdout.pipe(ffmpegProcess.stdin);
            resource = createAudioResource(ffmpegProcess.stdout, { inputType: StreamType.Raw });
        }
        if (resource && resource.playStream && typeof resource.playStream.on === 'function') {
            resource.playStream.on('error', () => {});
        }
        
        queue.player.play(resource);
        console.log(`▶️ Начал играть: ${track.title} (Эффект: ${queue.filter})`);
        recordStat(guildId, track);

        if (queue.progressInterval) {
            clearInterval(queue.progressInterval);
            queue.progressInterval = null;
        }

        if (queue.nowPlayingMessage) {
            queue.nowPlayingMessage.delete().catch(() => {});
            queue.nowPlayingMessage = null;
        }

        if (queue.textChannel) {
            queue.nowPlayingMessage = await queue.textChannel.send(createPlayerPayload(queue)).catch(() => null);
            queue.progressInterval = setInterval(() => {
                if (queue.player && queue.player.state.status === AudioPlayerStatus.Playing) {
                    updatePlayerEmbed(queue);
                }
            }, 5000);
        }
    } catch (e) {
        console.error('Ошибка при проигрывании стрима:', e.message || e);
        queue.current = null;
        const next = queue.tracks.shift();
        if (next) playTrack(guildId, next);
    }
}

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Необработанная ошибка (unhandledRejection):', reason?.message || reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ Критическая ошибка (uncaughtException):', error?.message || error);
});

client.login(process.env.DISCORD_TOKEN);
