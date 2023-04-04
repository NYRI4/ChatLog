import tmi from "tmi.js";
import fs from "fs";
import axios from "axios";
import config from "./config.json" assert { type: "json" };

const gBadges = [];
const cBadges = ["subscriber", "bits"];

// Get app token to call twitch API
const token = await axios
    .post(
        `https://id.twitch.tv/oauth2/token?client_secret=${config.secret}&client_id=${config.clientID}&grant_type=client_credentials`
    )
    .then((r) => {
        return r.data.access_token;
    });

// Get global badges names
await axios
    .get("https://api.twitch.tv/helix/chat/badges/global", {
        headers: {
            Authorization: `Bearer ${token}`,
            "Client-Id": `${config.clientID}`,
        },
    })
    .then((r) => {
        r.data.data.forEach((badge) => {
            gBadges.push(badge.set_id);
        });
    });

// Check if data.json exists
if (!fs.existsSync("./data.json"))
    fs.writeFileSync("./data.json", JSON.stringify({}));

const client = new tmi.Client({
    channels: [config.targetChannel],
});

async function getUserGlobalBadge(role, amount) {
    try {
        let badge;

        let globalBadges = await axios({
            method: "GET",
            url: `https://api.twitch.tv/helix/chat/badges/global`,
            headers: {
                Authorization: `Bearer ${token}`,
                "Client-Id": `${config.clientID}`,
            },
        });

        globalBadges.data.data.forEach((data) => {
            if (data.set_id == role) {
                data.versions.forEach((v) => {
                    if (v.id == amount) {
                        badge = v.image_url_4x;
                    }
                });
            }
        });

        return badge;
    } catch (e) {
        console.log(e);
    }
}

async function getUserChannelBadge(targetChannel, role, amount) {
    try {
        let badge;

        let getBroadcasterID = await axios({
            method: "GET",
            url: `https://api.twitch.tv/helix/users?login=${targetChannel}`,
            headers: {
                Authorization: `Bearer ${token}`,
                "Client-Id": `${config.clientID}`,
            },
        });

        let badges = await axios({
            method: "GET",
            url: `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${getBroadcasterID.data.data[0].id}`,
            headers: {
                Authorization: `Bearer ${token}`,
                "Client-Id": `${config.clientID}`,
            },
        });

        badges.data.data.forEach((data) => {
            if (data.set_id == role) {
                data.versions.forEach((v) => {
                    if (v.id == amount) {
                        badge = v.image_url_4x;
                    }
                });
            }
        });

        return badge;
    } catch (e) {
        console.log(e);
    }
}

async function getUserBadges(targetChannel, tags, customBadge) {
    // Works by order of priority

    // Custom badge is set
    if (customBadge != "") return customBadge;

    // User don't have badges
    if (tags.badges == null) return "";

    if (tags.badges.broadcaster != undefined) {
        return "https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/3";
    }

    if (tags.badges.moderator != undefined) {
        return "https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3";
    }

    if (tags.badges.vip != undefined) {
        return "https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/3";
    }

    for (let i = 0; i < cBadges.length; i++) {
        if (tags.badges[cBadges[i]] != undefined) {
            return await getUserChannelBadge(
                targetChannel,
                cBadges[i],
                tags.badges[cBadges[i]]
            );
        }
    }

    for (let i = 0; i < gBadges.length; i++) {
        if (tags.badges[gBadges[i]] != undefined) {
            return await getUserGlobalBadge(
                gBadges[i],
                tags.badges[gBadges[i]]
            );
        }
    }
}

const onMessage = async (channel, tags, message, self) => {
    let username = tags["display-name"];
    let timestamp = new Date();

    // Waiting for the user's message
    let getUser = config.targetUsers.filter(
        (i) => i.username.toLowerCase() == username.toLowerCase()
    );
    if (getUser.length != 1) return;
    let user = getUser[0];

    let embed = {
        embeds: [
            {
                author: {
                    name: `${username}`,
                    icon_url: await getUserBadges(
                        config.targetChannel,
                        tags,
                        user.customBadge
                    ),
                },
                description: `${message}`,
                color:
                    tags.color != null
                        ? parseInt(tags.color.substring(1), 16)
                        : parseInt("000000", 16),
                timestamp: timestamp,
            },
        ],
    };

    // Save last message date
    let data = JSON.parse(fs.readFileSync("./data.json"));
    fs.writeFileSync(
        "./data.json",
        JSON.stringify({
            ...data,
            [`lastSent_${username.toLowerCase()}`]: timestamp,
        })
    );

    // Send message when they send a message first time in a long while
    if (
        user.notice &&
        timestamp - new Date(data[`lastSent_${username.toLowerCase()}`]) >
            config.notifyAfter
    ) {
        embed.content = user.noticeMessage;
    }

    embed = JSON.stringify(embed);

    notifyServer(embed);
};

const notifyServer = async (embed) => {
    return axios({
        method: "POST",
        url: config.webhookUrl,
        headers: {
            "Content-Type": "application/json",
        },
        data: embed,
    });
};

client.connect();
client.on("message", onMessage);

console.log(`Bot started! Targeting for ${config.targetUsers.length} users`);
