// 大宗分流 - 双漏斗填充脚本 (打包机 + 潜影盒分类)
const scriptName = "大宗分流填充";
if (GlobalVars.getBoolean(scriptName)) {
    GlobalVars.putBoolean(scriptName, false);
    Chat.log("脚本已停止");
    throw new Error("脚本手动停止");
}
GlobalVars.putBoolean(scriptName, true);

// ===== 用户配置 =====
// 每个面需提供两组偏移：打包机漏斗(packerOffset) 和 潜影盒漏斗(shulkerOffset)
const ScanFaces = [
    // --- 左侧各层示例，请替换为实际坐标 ---
    { name: "左侧", startPos: pos(-52,128,-883), endPos: pos(-105,128,-883), faceOffset: "north", packerOffset: [0,10,-25], shulkerOffset: [0,24,4] },
    { name: "右侧", startPos: pos(-52,128,-891), endPos: pos(-105,128,-891), faceOffset: "south", packerOffset: [0,0,-17], shulkerOffset: [0,24,-4] },
];

const BASE_BLOCK = "minecraft:calcite";
const MAX_ITEMS_LENGTH = 1000;
const SHULKER_BOX_ID = "minecraft:shulker_box"; // 潜影盒分类占位用

// ===== 初始化 =====
const ItemList = Client.getRegisteredItems();
const Block2Item = new Map();
Client.getRegisteredItems().forEach(item => {
    if (item.isBlockItem() && item.getId().includes("minecraft"))
        Block2Item.set(item.getBlock().getId(), item.getId());
});
Client.getRegisteredBlocks().forEach(block => {
    if (block.getTags().includes("minecraft:flower_pots")) {
        const id = block.getId();
        if (id.includes("azalea")) {
            Block2Item.set(id, id.replace("potted_", "").replace("_bush", ""));
        } else {
            Block2Item.set(id, id.replace("potted_", ""));
        }
    }
});

const itemFrameMap = new Map();
World.getEntities("minecraft:item_frame").forEach(entity => {
    const pos = entity.getBlockPos();
    const item = entity.getItem();
    if (item) itemFrameMap.set(`${pos.getX()},${pos.getY()},${pos.getZ()}`, item);
});

function pos(x, y, z) {
    return PositionCommon.createBlockPos(x, y, z);
}
function pos2str(p) {
    return `${p.getX()},${p.getY()},${p.getZ()}`;
}

// ===== 主逻辑 =====
const commandsToExecute = [];

ScanFaces.forEach(face => {
    Chat.log(`扫描面: ${face.name}`);
    scanFace(face);
});

Chat.log(`共生成 ${commandsToExecute.length} 条命令，开始执行...`);
commandsToExecute.forEach((cmd, i) => {
    Chat.say(cmd);
    if (i % 10 === 0 && i > 0) Client.waitTick(1);
});
Chat.log("全部命令执行完毕");
GlobalVars.putBoolean(scriptName, false);

// ===== 扫描单个面（生成两个漏斗的命令） =====
function scanFace(cfg) {
    const dir = direction(cfg.startPos, cfg.endPos);
    if (!dir) {
        Chat.log(`[错误] ${cfg.name} 起止坐标不在同一轴线上`);
        return;
    }
    let current = cfg.startPos;
    let count = 0;
    while (count < MAX_ITEMS_LENGTH) {
        const block = World.getBlock(current);
        if (!block) break;

        const itemData = getItemId(current, cfg.faceOffset);

        // 打包机漏斗
        const packerPos = current.offset(cfg.packerOffset[0], cfg.packerOffset[1], cfg.packerOffset[2]);
        const packerCmds = buildPackerCommands(packerPos, itemData);
        packerCmds.forEach(c => commandsToExecute.push(c));

        // 潜影盒分类漏斗
        const shulkerPos = current.offset(cfg.shulkerOffset[0], cfg.shulkerOffset[1], cfg.shulkerOffset[2]);
        const shulkerCmds = buildShulkerCommands(shulkerPos, itemData);
        shulkerCmds.forEach(c => commandsToExecute.push(c));

        //先判定，再移动，以包含结束位置
        if (current.equals(cfg.endPos)) break;
        current = current.offset(dir.dx, dir.dy, dir.dz);
        count++;
    }
    Chat.log(`[${cfg.name}] 扫描完成，处理 ${count+1} 个位置`);
}

// 判断单轴方向
function direction(from, to) {
    const dx = to.getX() - from.getX();
    const dy = to.getY() - from.getY();
    const dz = to.getZ() - from.getZ();
    const axes = [dx !== 0, dy !== 0, dz !== 0].filter(Boolean).length;
    if (axes > 1) return null;
    const len = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (len === 0) return null;
    return {
        dx: dx !== 0 ? dx / Math.abs(dx) : 0,
        dy: dy !== 0 ? dy / Math.abs(dy) : 0,
        dz: dz !== 0 ? dz / Math.abs(dz) : 0
    };
}

// 获取物品ID（不展开潜影盒，无物品返回 null）
function getItemId(pos, faceOffset) {
    const checkPos = pos.offset(faceOffset);
    const frameItem = itemFrameMap.get(pos2str(checkPos));
    if (frameItem) {
        const itemId = frameItem.getItemId();
        let extraNbt = "";
        const nbt = frameItem.getNBT();
        if (nbt) {
            if (nbt.has("tag")) {
                extraNbt = `,tag:${nbt.get("tag").toString().replace(/^NBTElementHelper:/, "").slice(1, -1)}`;
            }
        }
        return { itemId, extraNbt };
    }

    const block = World.getBlock(pos);
    const blockId = block.getId();

    // 非基底、非空气 → 直接映射为物品
    if (blockId !== BASE_BLOCK && blockId !== "minecraft:air") {
        const item = Block2Item.get(blockId.replace("wall_", ""));
        if (item) return { itemId: item, extraNbt: "" };
    }

    // 附着方块检查
    const attachedBlock = World.getBlock(checkPos);
    if (attachedBlock.getId() !== "minecraft:air") {
        const item = Block2Item.get(attachedBlock.getId().replace("wall_", ""));
        if (item) return { itemId: item, extraNbt: "" };
    }

    return null; // 无物品
}

// 打包机漏斗命令生成
function buildPackerCommands(funnelPos, itemData) {
    const x = funnelPos.getX(), y = funnelPos.getY(), z = funnelPos.getZ();
    const cmds = [];

    // 空气 → 乐色A
    if (!itemData || itemData.itemId === "minecraft:air") {
        cmds.push(`/data modify block ${x} ${y} ${z} Items[0] set value {Slot:0b,id:"minecraft:gold_nugget",Count:1b,tag:{RepairCost:0,display:{Name:'{"text":"乐色A"}'}}}`);
        return cmds;
    }

    const { itemId, extraNbt } = itemData;

    const itemStack = ItemList.find(i => i.getId() === itemId)?.getDefaultStack();
    if (!itemStack) {
        Chat.log(`[错误] 未找到物品: ${itemId}`);
        return cmds;
    }
    const maxCount = itemStack.getMaxCount();
    const idShort = itemId.replace("minecraft:", "");

    if (maxCount !== 64) {
        Chat.log(`[错误] 大宗打包机出现非64堆叠物品: ${itemId} (max=${maxCount})，跳过修改 (${x},${y},${z})`);
        return cmds;
    }

    // 正常64堆叠：slot0 放2个，其余恢复5个乐色B
    cmds.push(`/data modify block ${x} ${y} ${z} Items[0] set value {Slot:0b,id:"${idShort}",Count:2b${extraNbt}}`);
    cmds.push(`/data modify block ${x} ${y} ${z} Items[1] set value {Slot:1b,id:"minecraft:iron_nugget",Count:5b,tag:{RepairCost:0,display:{Name:'{"text":"乐色B"}'}}}`);
    cmds.push(`/data modify block ${x} ${y} ${z} Items[2] set value {Slot:2b,id:"minecraft:iron_nugget",Count:5b,tag:{RepairCost:0,display:{Name:'{"text":"乐色B"}'}}}`);
    cmds.push(`/data modify block ${x} ${y} ${z} Items[3] set value {Slot:3b,id:"minecraft:iron_nugget",Count:5b,tag:{RepairCost:0,display:{Name:'{"text":"乐色B"}'}}}`);
    cmds.push(`/data modify block ${x} ${y} ${z} Items[4] set value {Slot:4b,id:"minecraft:iron_nugget",Count:5b,tag:{RepairCost:0,display:{Name:'{"text":"乐色B"}'}}}`);
    return cmds;
}

// 潜影盒分类漏斗命令生成
function buildShulkerCommands(funnelPos, itemData) {
    const x = funnelPos.getX(), y = funnelPos.getY(), z = funnelPos.getZ();
    const cmds = [];
    const shulkerId = SHULKER_BOX_ID.replace("minecraft:", "");

    // 空气 → 乐色A（也可以设为潜影盒占位，这里保持统一用乐色A）
    if (!itemData || itemData.itemId === "minecraft:air") {
        cmds.push(`/data modify block ${x} ${y} ${z} Items[0] set value {Slot:0b,id:"minecraft:gold_nugget",Count:1b,tag:{RepairCost:0,display:{Name:'{"text":"乐色A"}'}}}`);
        return cmds;
    }

    const { itemId, extraNbt } = itemData;

    const itemStack = ItemList.find(i => i.getId() === itemId)?.getDefaultStack();
    if (!itemStack) {
        Chat.log(`[错误] 未找到物品: ${itemId}`);
        return cmds;
    }
    const maxCount = itemStack.getMaxCount();
    const idShort = itemId.replace("minecraft:", "");

    if (maxCount !== 64) {
        Chat.log(`[错误] 大宗潜影盒分类出现非64堆叠物品: ${itemId} (max=${maxCount})，跳过修改 (${x},${y},${z})`);
        return cmds;
    }

    // 正常64堆叠：slot0 放1个物品，其余槽位各放1个潜影盒
    cmds.push(`/data modify block ${x} ${y} ${z} Items[0] set value {Slot:0b,id:"${idShort}",Count:1b${extraNbt}}`);
    cmds.push(`/data modify block ${x} ${y} ${z} Items[1] set value {Slot:1b,id:"${shulkerId}",Count:1b}`);
    cmds.push(`/data modify block ${x} ${y} ${z} Items[2] set value {Slot:2b,id:"${shulkerId}",Count:1b}`);
    cmds.push(`/data modify block ${x} ${y} ${z} Items[3] set value {Slot:3b,id:"${shulkerId}",Count:1b}`);
    cmds.push(`/data modify block ${x} ${y} ${z} Items[4] set value {Slot:4b,id:"${shulkerId}",Count:1b}`);
    return cmds;
}