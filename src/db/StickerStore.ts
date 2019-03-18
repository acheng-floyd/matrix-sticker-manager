import { LogService, MatrixClient } from "matrix-bot-sdk";
import * as randomString from "random-string";
import config from "../config";

export interface Stickerpack extends StickerpackMetadata {
    roomId: string;
    roomAlias: string;
    stickers: Sticker[];
}

export interface Sticker extends StickerMetadata {
    id: string;
    packId: string;
}

export interface StickerpackMetadata {
    id: string;
    creatorId: string;
    name: string;
    stickers: StickerMetadata[];
}

export interface StickerMetadata {
    description: string;
    contentUri: string;
}

export class StickerStore {

    private packs: { [packId: string]: Stickerpack } = {};
    private packsToRooms: { [packId: string]: string } = {};

    constructor(private client: MatrixClient) {
        this.loadData();
    }

    private async loadData() {
        let data = {};
        try {
            data = await this.client.getAccountData("io.t2bot.stickers.cache");
        } catch (e) {
            LogService.warn("StickerStore", "No account data or error retrieving store - returning");
        }

        this.packsToRooms = data;
        LogService.info("StickerStore", `Loaded ${Object.keys(this.packsToRooms).length} known packs`);
    }

    private async saveData() {
        await this.client.setAccountData("io.t2bot.stickers.cache", this.packsToRooms);
    }

    public async createStickerpack(pack: StickerpackMetadata): Promise<Stickerpack> {
        const stickers = pack.stickers.map(s => {
            return {
                id: randomString({length: 64}),
                packId: pack.id,
                description: s.description,
                contentUri: s.contentUri,
            }
        });

        const roomId = await this.client.createRoom({
            name: pack.name,
            room_alias_name: "_stickerpack_" + pack.id,
            room_version: "3",
            creation_content: {
                "io.t2bot.stickers": {
                    pack_author: pack.creatorId,
                },
            },
            preset: "public_chat",
            initial_state: [
                {
                    type: "io.t2bot.stickers.metadata",
                    state_key: "",
                    content: {
                        creatorId: pack.creatorId,
                        activeStickers: stickers.map(s => s.id),
                    },
                },
                ...(stickers.map(s => {
                    return {type: "io.t2bot.stickers.sticker", state_key: s.id, content: s};
                })),
            ],
        });

        const finalPack = {
            id: pack.id,
            roomId: roomId,
            roomAlias: `#_stickerpack_${pack.id}:${config.appservice.domainName}`,
            creatorId: pack.creatorId,
            name: pack.name,
            stickers: stickers,
        };

        this.packs[pack.id] = finalPack;
        this.packsToRooms[pack.id] = roomId;

        await this.saveData();
        return finalPack;
    }

    public async saveStickerpack(pack: Stickerpack): Promise<Stickerpack> {
        const stickers = pack.stickers.map(s => {
            return {
                id: s.id,
                packId: pack.id,
                description: s.description,
                contentUri: s.contentUri,
            }
        });

        const eventsToSend = [
            ...(stickers.map(s => {
                return {type: "io.t2bot.stickers.sticker", state_key: s.id, content: s};
            })),
            {
                type: "io.t2bot.stickers.metadata",
                state_key: "",
                content: {
                    creatorId: pack.creatorId,
                    activeStickers: stickers.map(s => s.id),
                },
            },
        ];

        for (const event of eventsToSend) {
            await this.client.sendStateEvent(pack.roomId, event.type, event.state_key, event.content);
        }

        this.packs[pack.id] = pack;
        return pack;
    }

    public async getStickerpack(id: string): Promise<Stickerpack> {
        console.log(id);
        if (this.packs[id]) return this.packs[id];
        if (!this.packsToRooms[id]) return null;

        const roomId = this.packsToRooms[id];

        const nameEvent = await this.client.getRoomStateEvent(roomId, "m.room.name", "");
        if (!nameEvent) return null;

        const canconicalAliasEvent = await this.client.getRoomStateEvent(roomId, "m.room.canonical_alias", "");
        if (!canconicalAliasEvent) return null;

        const packEvent = await this.client.getRoomStateEvent(roomId, "io.t2bot.stickers.metadata", "");
        if (!packEvent) return null;

        const pack: Stickerpack = {
            id: packEvent.id,
            creatorId: packEvent.creatorId,
            roomId: roomId,
            stickers: [],
            name: nameEvent.name,
            roomAlias: canconicalAliasEvent.alias,
        };

        for (const stickerId of packEvent.activeStickers) {
            const stickerEvent = await this.client.getRoomStateEvent(roomId, "io.t2bot.stickers.sticker", stickerId);
            if (!stickerEvent) continue;

            pack.stickers.push({
                id: stickerId,
                description: stickerEvent.description,
                contentUri: stickerEvent.contentUri,
                packId: pack.id,
            });
        }

        this.packs[id] = pack;

        return pack;
    }
}