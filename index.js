require('dotenv').config();
process.env.FFMPEG_PATH = require('ffmpeg-static');
const { Client, GatewayIntentBits, REST, Routes, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const play = require('play-dl');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

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
    { name: 'queue', description: 'Показать текущую очередь' }
];

client.once('ready', async () => {
    console.log(`✅ Бот ${client.user.tag} успешно запущен и работает на новом движке play-dl!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Слэш-команды успешно зарегистрированы!');
    } catch (error) {
        console.error('Ошибка при регистрации команд:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
        return interaction.reply({ content: '❌ Вы должны находиться в голосовом канале!', ephemeral: true });
    }

    let queue = queues.get(interaction.guildId);

    if (commandName === 'play') {
        await interaction.deferReply();
        const query = interaction.options.getString('query');
        
        try {
            let selectedTrack = null;

            if (query.startsWith('http')) {
                // Прямая ссылка на видео или плейлист (упрощенно берем только видео)
                const info = await play.video_info(query);
                selectedTrack = {
                    title: info.video_details.title,
                    url: info.video_details.url
                };
            } else {
                // Поиск
                const searchResults = await play.search(query, { limit: 5 });
                if (!searchResults || searchResults.length === 0) {
                    return interaction.followUp('❌ Ничего не найдено!');
                }

                const select = new StringSelectMenuBuilder()
                    .setCustomId('track_select')
                    .setPlaceholder('Выберите трек для воспроизведения')
                    .addOptions(
                        searchResults.map((track, i) => 
                            new StringSelectMenuOptionBuilder()
                                .setLabel(track.title.substring(0, 100))
                                .setDescription(`⏱️ ${track.durationRaw || '?:??'} | 👤 ${(track.channel?.name || 'Неизвестный автор').substring(0, 70)}`)
                                .setValue(i.toString())
                        )
                    );

                const row = new ActionRowBuilder().addComponents(select);
                const response = await interaction.followUp({
                    content: '🔍 Я нашел несколько вариантов. Выберите один из них (у вас есть 1 минута):',
                    components: [row]
                });

                const confirmation = await response.awaitMessageComponent({ 
                    filter: i => i.user.id === interaction.user.id,
                    time: 60000, 
                    componentType: ComponentType.StringSelect 
                });

                selectedTrack = {
                    title: searchResults[parseInt(confirmation.values[0])].title,
                    url: searchResults[parseInt(confirmation.values[0])].url
                };
                console.log('Выбранный трек:', selectedTrack);
                
                await confirmation.update({ content: `⏳ Подключаюсь и загружаю: **${selectedTrack.title}**...`, components: [] });
            }

            // Инициализация очереди и плеера, если их нет
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
                    current: null
                };
                
                connection.subscribe(player);
                queues.set(interaction.guildId, queue);

                player.on(AudioPlayerStatus.Idle, () => {
                    if (queue.subprocess) {
                        queue.subprocess.kill();
                        queue.subprocess = null;
                    }
                    queue.current = null;
                    const nextTrack = queue.tracks.shift();
                    if (nextTrack) {
                        playTrack(interaction.guildId, nextTrack);
                    }
                });

                connection.on(VoiceConnectionStatus.Disconnected, () => {
                    connection.destroy();
                    queues.delete(interaction.guildId);
                });
            }

            queue.tracks.push(selectedTrack);
            
            if (queue.player.state.status === AudioPlayerStatus.Idle && queue.current === null) {
                const nextTrack = queue.tracks.shift();
                await playTrack(interaction.guildId, nextTrack);
                return interaction.editReply({ content: `🎶 Начинаю воспроизведение: **${selectedTrack.title}**`, components: [] });
            } else {
                return interaction.editReply({ content: `🎵 Трек добавлен в очередь: **${selectedTrack.title}**`, components: [] });
            }

        } catch (e) {
            console.error(e);
            if (e.code === 'InteractionCollectorError') {
                return interaction.editReply({ content: '❌ Вы не выбрали трек вовремя.', components: [] });
            }
            return interaction.editReply({ content: `❌ Произошла ошибка. Попробуйте еще раз.`, components: [] });
        }
    }

    if (commandName === 'stop') {
        if (!queue) return interaction.reply({ content: '❌ Сейчас ничего не играет.', ephemeral: true });
        queue.tracks = [];
        queue.player.stop();
        queue.connection.destroy();
        queues.delete(interaction.guildId);
        return interaction.reply('🛑 Музыка остановлена, очередь очищена.');
    }

    if (commandName === 'pause') {
        if (!queue) return interaction.reply({ content: '❌ Сейчас ничего не играет.', ephemeral: true });
        queue.player.pause();
        return interaction.reply('⏸️ Музыка поставлена на паузу.');
    }

    if (commandName === 'resume') {
        if (!queue) return interaction.reply({ content: '❌ Сейчас ничего не играет.', ephemeral: true });
        queue.player.unpause();
        return interaction.reply('▶️ Музыка снята с паузы.');
    }

    if (commandName === 'skip') {
        if (!queue || !queue.current) return interaction.reply({ content: '❌ Сейчас ничего не играет.', ephemeral: true });
        queue.player.stop(); // Остановка вызовет переход к следующему треку
        return interaction.reply('⏭️ Трек пропущен.');
    }

    if (commandName === 'queue') {
        if (!queue) return interaction.reply({ content: '❌ Сейчас ничего не играет.', ephemeral: true });
        
        let queueString = queue.current ? `**Сейчас играет:** ${queue.current.title}\n\n**Очередь:**\n` : '**Очередь:**\n';
        
        if (queue.tracks.length === 0) {
            queueString += '*Очередь пуста*';
        } else {
            queueString += queue.tracks.map((t, i) => `${i + 1}. ${t.title}`).slice(0, 10).join('\n');
            if (queue.tracks.length > 10) queueString += `\n...и еще ${queue.tracks.length - 10} треков`;
        }
        
        return interaction.reply({ content: queueString });
    }
});

async function playTrack(guildId, track) {
    const queue = queues.get(guildId);
    if (!queue) return;
    try {
        queue.current = track;
        
        if (queue.subprocess) {
            queue.subprocess.kill();
        }
        
        // Используем непрерывный стриминг через yt-dlp
        // yt-dlp сам обойдет лимиты и обрывы соединения
        const { exec } = require('youtube-dl-exec');
        const subprocess = exec(track.url, {
            o: '-', // направляем поток напрямую
            q: true,
            f: 'bestaudio'
        }, { stdio: ['ignore', 'pipe', 'ignore'] });

        queue.subprocess = subprocess;

        // Передаем этот живой поток напрямую в Discord
        const resource = createAudioResource(subprocess.stdout);
        
        queue.player.play(resource);
        console.log(`▶️ Начал играть: ${track.title}`);
    } catch (e) {
        console.error('Ошибка при проигрывании стрима:', e.message || e);
        queue.current = null;
        const next = queue.tracks.shift();
        if (next) playTrack(guildId, next);
    }
}

client.login(process.env.DISCORD_TOKEN);
