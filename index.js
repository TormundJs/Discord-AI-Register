const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { connectDatabase, User } = require('./database');
const { recordUserVoice, compareVoiceSamples } = require('./voiceRecorder');

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Cache set to track active recordings
client.activeRecordings = new Set();

// Startup initialization
client.once(Events.ClientReady, () => {
    console.log(`[BOT] Connected to Discord as ${client.user.tag}`);
    
    // Ensure voice_samples folder exists
    const samplesDir = path.join(__dirname, 'voice_samples');
    if (!fs.existsSync(samplesDir)) {
        fs.mkdirSync(samplesDir, { recursive: true });
    }
});

// Voice State Update handler (AI Registration Officer Hook)
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    if (oldState.member?.user.bot || newState.member?.user.bot) return;

    const voiceChannelId = process.env.VOICE_CHANNEL_ID;
    const logChannelId = process.env.LOG_CHANNEL_ID;
    const unregisterRoleId = process.env.UNREGISTER_ROLE_ID;
    const manRoleId = process.env.MAN_ROLE_ID;
    const womanRoleId = process.env.WOMAN_ROLE_ID;
    const serverTag = process.env.SERVER_TAG || '';

    // Trigger only when joining the designated register channel
    if (newState.channelId && newState.channelId === voiceChannelId) {
        
        // Evaluate if the user is unregistered
        const roles = newState.member.roles.cache;
        const isUnregistered = roles.has(unregisterRoleId) || (!roles.has(manRoleId) && !roles.has(womanRoleId));
        
        if (isUnregistered) {
            
            // Prevent concurrent recordings for the same user
            if (client.activeRecordings.has(newState.id)) {
                return;
            }
            client.activeRecordings.add(newState.id);
            
            const logChannel = logChannelId ? newState.guild.channels.cache.get(logChannelId) : null;
            
            if (logChannel) {
                await logChannel.send({
                    content: `🎙️ ${newState.member}, **Yapay Zeka Sesli Kayıt Asistanı** bağlandı.\n` +
                             `Lütfen mikrofonunuzu açıp adınızı ve yaşınızı söyleyin.\n` +
                             `*Örnek: "Ben Ahmet, 18 yaşındayım."*`
                }).catch(() => {});
            }

            let connection;
            try {
                // Connect to Voice Channel
                connection = getVoiceConnection(newState.guild.id);
                if (!connection) {
                    connection = joinVoiceChannel({
                        channelId: newState.channel.id,
                        guildId: newState.guild.id,
                        adapterCreator: newState.guild.voiceAdapterCreator,
                        selfDeaf: false,
                        selfMute: false
                    });
                }

                // Wait for voice state connection to be Ready
                await entersState(connection, VoiceConnectionStatus.Ready, 20000);
                
                // Start recording
                const result = await recordUserVoice(connection, newState.id);
                
                if (result && result.success === true) {
                    let name = result.name;
                    let age = Number(result.age);
                    let gender = result.gender;

                    // 1. Check if user has a previous registration record in DB
                    let hasPreviousRecord = false;
                    try {
                        const selfDoc = await User.findOne({ userID: newState.id });
                        if (selfDoc && selfDoc.userName && selfDoc.Gender) {
                            hasPreviousRecord = true;
                            
                            // If they have a saved voice sample, verify it's the same person
                            if (selfDoc.voiceSample) {
                                console.log(`[VOICE-EVENT] User has previous voice sample. Verifying identity...`);
                                const selfCompare = await compareVoiceSamples(result.wavBuffer, [{
                                    userID: newState.id,
                                    username: selfDoc.userName,
                                    voiceSamplePath: selfDoc.voiceSample
                                }]);
                                
                                if (!selfCompare || selfCompare.highestSimilarityScore < 85) {
                                    console.warn(`[VOICE-EVENT] Self verification failed for user ${newState.member.user.tag}!`);
                                    if (logChannel) {
                                        await logChannel.send({
                                            content: `❌ ${newState.member} ses analizi ile kayıt edilemedi! **Kimlik Doğrulama Başarısız!** ⚠️\n` +
                                                     `• Bu hesabın ilk sahibinin sesi ile şu anki konuşan kişinin sesi uyuşmuyor (Benzerlik: \`%${selfCompare ? selfCompare.highestSimilarityScore : 0}\`).`
                                        });
                                    }
                                    return; // Block registration
                                }
                            }

                            // Override AI extraction with original database values
                            console.log(`[VOICE-EVENT] User already has a registered name: ${selfDoc.userName}. Overriding AI...`);
                            const dbNick = selfDoc.userName;
                            const dbGender = selfDoc.Gender;
                            
                            const nickParts = dbNick.split('|');
                            name = nickParts[0].trim();
                            age = nickParts[1] ? Number(nickParts[1].trim()) : (Number(result.age) || 20);
                            gender = dbGender === 'Male' ? 'male' : 'female';
                        }
                    } catch (err) {
                        console.error("[VOICE-EVENT] Error checking previous record:", err.message);
                    }

                    // 2. Alt Account Detection (If no previous record)
                    let isAltAccount = false;
                    let matchedUserText = "";
                    let similarityScore = 0;
                    let compareReasoning = "";

                    if (!hasPreviousRecord) {
                        try {
                            const rawSamples = await User.find({ 
                                voiceSample: { $exists: true, $ne: null },
                                userID: { $ne: newState.id }
                            }).sort({ _id: -1 }).limit(5);

                            const comparisonList = [];
                            for (const u of rawSamples) {
                                let username = u.userName || u.userID;
                                try {
                                    const fetchedUser = await client.users.fetch(u.userID);
                                    if (fetchedUser) username = fetchedUser.username;
                                } catch(e) {}
                                
                                comparisonList.push({
                                    userID: u.userID,
                                    username: username,
                                    voiceSamplePath: u.voiceSample
                                });
                            }

                            if (comparisonList.length > 0 && result.wavBuffer) {
                                console.log(`[VOICE-EVENT] Running voice biometric check against ${comparisonList.length} references...`);
                                const compareResult = await compareVoiceSamples(result.wavBuffer, comparisonList);
                                
                                if (compareResult && compareResult.highestSimilarityScore >= 85) {
                                    const highestMatchId = compareResult.highestMatchUserId;
                                    if (highestMatchId && highestMatchId !== newState.id) {
                                        isAltAccount = true;
                                        matchedUserText = highestMatchId;
                                        similarityScore = compareResult.highestSimilarityScore;
                                        compareReasoning = compareResult.reasoning || "";
                                    }
                                }
                            }
                        } catch (err) {
                            console.error("[VOICE-EVENT] Biometric check failed:", err.message);
                        }

                        if (isAltAccount) {
                            console.warn(`[VOICE-EVENT] Alt account detected for user ${newState.id}`);
                            if (logChannel) {
                                await logChannel.send({
                                    content: `❌ ${newState.member} ses analizi ile kayıt edilemedi! **Çift Kayıt / Alt Hesap Tespiti!** ⚠️\n` +
                                             `• **Eşleşen Hesap:** <@${matchedUserText}> (\`${matchedUserText}\`)\n` +
                                             `• **Ses Benzerliği:** \`%${similarityScore}\`\n` +
                                             `• **Analiz:** *"${compareReasoning}"*\n` +
                                             `• **Ses Çözümlemesi:** *"${result.transcription}"*`
                                });
                            }
                            return; // Block registration
                        }
                    }

                    // 3. Save WAV Voice Sample
                    const samplePath = path.join(__dirname, 'voice_samples', `${newState.id}.wav`);
                    try {
                        if (result.wavBuffer) {
                            fs.writeFileSync(samplePath, result.wavBuffer);
                            console.log(`[VOICE-EVENT] Saved voice sample for ${newState.id}`);
                        }
                    } catch (e) {
                        console.error("[VOICE-EVENT] Failed to save WAV file:", e.message);
                    }

                    // 4. Update Discord Nickname & Roles
                    const newNickname = `${serverTag ? serverTag + ' ' : ''}${name} | ${age}`;
                    await newState.member.setNickname(newNickname).catch(e => console.error("Nickname error:", e.message));

                    const roleToAdd = gender === 'male' ? manRoleId : womanRoleId;
                    if (roleToAdd) {
                        await newState.member.roles.add(roleToAdd).catch(e => console.error("Add role error:", e.message));
                    }
                    if (unregisterRoleId) {
                        await newState.member.roles.remove(unregisterRoleId).catch(e => console.error("Remove role error:", e.message));
                    }

                    // 5. Save to MongoDB
                    const dbGender = gender === 'male' ? 'Male' : 'Girl';
                    const dbName = `${name} | ${age}`;
                    await User.updateOne(
                        { userID: newState.id },
                        { 
                            $set: { 
                                userName: dbName, 
                                Gender: dbGender, 
                                Registrant: client.user.id,
                                voiceSample: samplePath
                            }, 
                            $push: { 
                                Names: { 
                                    Staff: client.user.id, 
                                    Name: dbName, 
                                    Type: dbGender, 
                                    Reason: "Yapay Zeka İle Kaydedildi",
                                    Date: Date.now() 
                                } 
                            } 
                        }, 
                        { upsert: true }
                    ).catch(e => console.error("DB Update error:", e.message));

                    // 6. Log success to Discord Log Channel
                    if (logChannel) {
                        await logChannel.send({
                            content: `✅ ${newState.member} ses analizi ile başarıyla kayıt edildi!\n` +
                                     `• **İsim:** \`${name}\`\n` +
                                     `• **Yaş:** \`${age}\`\n` +
                                     `• **Cinsiyet:** \`${gender === 'male' ? 'Erkek ♂' : 'Kadın ♀'}\`\n` +
                                     `• **Yöntem:** \`Yapay Zeka İle Kaydedildi\`\n` +
                                     `• **Ses Çözümlemesi:** *"${result.transcription}"*`
                        }).catch(() => {});
                    }
                } else {
                    if (logChannel) {
                        await logChannel.send({
                            content: `❌ ${newState.member} ses kaydı başarısız oldu. Yapay zeka adınızı veya yaşınızı net algılayamadı.\n` +
                                     `• **Ses Çözümlemesi:** *"${result.transcription || 'Belirsiz/Ses algılanamadı'}"*`
                        }).catch(() => {});
                    }
                }
            } catch (err) {
                console.error('[VOICE-EVENT] Error during registration lifecycle:', err.message);
                if (logChannel) {
                    await logChannel.send({ content: `⚠️ ${newState.member} ses kaydı sırasında hata oluştu: ${err.message}` }).catch(() => {});
                }
            } finally {
                client.activeRecordings.delete(newState.id);
                
                // Clean connection if no one else is currently being recorded
                if (client.activeRecordings.size === 0) {
                    const activeConn = getVoiceConnection(newState.guild.id);
                    if (activeConn) activeConn.destroy();
                }
            }
        }
    }
});

// Run Bot
async function startApp() {
    if (!process.env.DISCORD_TOKEN || !process.env.MONGO_URI) {
        console.error('[ERROR] Config variables missing in .env');
        process.exit(1);
    }
    
    await connectDatabase(process.env.MONGO_URI);
    await client.login(process.env.DISCORD_TOKEN);
}

startApp();
