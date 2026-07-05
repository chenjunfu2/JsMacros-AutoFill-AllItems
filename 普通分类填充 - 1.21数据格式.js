// 分流全物品 - 漏斗过滤填充脚本 v3
// 自动根据扫描到的物品修改漏斗的 slot0（及 16 堆叠时的 slot3/4）
const scriptName = "分流全物品填充";
if (GlobalVars.getBoolean(scriptName)) {
    GlobalVars.putBoolean(scriptName, false);
    Chat.log("脚本已停止");
    throw new Error("脚本手动停止");
}
GlobalVars.putBoolean(scriptName, true);

// ===== 用户配置 =====
// { name, startPos, endPos, faceOffset, funnelOffset: [dx, dy, dz] }
const ScanFaces = [
    { name: "左地面0", startPos: pos(-31,123,-872), endPos: pos(-31,123,-821), faceOffset: "up", funnelOffset: [5,0,0] },
    { name: "右地面0", startPos: pos(-37,123,-872), endPos: pos(-37,123,-821), faceOffset: "up", funnelOffset: [-5,0,0] },
    { name: "左低层0", startPos: pos(-28,124,-872), endPos: pos(-28,124,-821), faceOffset: "west", funnelOffset: [3,2,0] },
    { name: "右低层0", startPos: pos(-40,124,-872), endPos: pos(-40,124,-821), faceOffset: "east", funnelOffset: [-3,2,0] },
    { name: "左中层0", startPos: pos(-28,127,-872), endPos: pos(-28,127,-821), faceOffset: "west", funnelOffset: [1,3,0] },
    { name: "右中层0", startPos: pos(-40,127,-872), endPos: pos(-40,127,-821), faceOffset: "east", funnelOffset: [-1,3,0] },
    { name: "左高层0", startPos: pos(-29,129,-872), endPos: pos(-29,129,-821), faceOffset: "west", funnelOffset: [0,5,0] },
    { name: "右高层0", startPos: pos(-39,129,-872), endPos: pos(-39,129,-821), faceOffset: "east", funnelOffset: [0,5,0] },
    { name: "左顶面0", startPos: pos(-31,130,-872), endPos: pos(-31,130,-821), faceOffset: "down", funnelOffset: [-1,8,0] },
    { name: "右顶面0", startPos: pos(-37,130,-872), endPos: pos(-37,130,-821), faceOffset: "down", funnelOffset: [1,8,0] },

    { name: "左地面1", startPos: pos(-31,123,-953), endPos: pos(-31,123,-902), faceOffset: "up", funnelOffset: [5,0,0] },
    { name: "右地面1", startPos: pos(-37,123,-953), endPos: pos(-37,123,-902), faceOffset: "up", funnelOffset: [-5,0,0] },
    { name: "左低层1", startPos: pos(-28,124,-953), endPos: pos(-28,124,-902), faceOffset: "west", funnelOffset: [3,2,0] },
    { name: "右低层1", startPos: pos(-40,124,-953), endPos: pos(-40,124,-902), faceOffset: "east", funnelOffset: [-3,2,0] },
    { name: "左中层1", startPos: pos(-28,127,-953), endPos: pos(-28,127,-902), faceOffset: "west", funnelOffset: [1,3,0] },
    { name: "右中层1", startPos: pos(-40,127,-953), endPos: pos(-40,127,-902), faceOffset: "east", funnelOffset: [-1,3,0] },
    { name: "左高层1", startPos: pos(-29,129,-953), endPos: pos(-29,129,-902), faceOffset: "west", funnelOffset: [0,5,0] },
    { name: "右高层1", startPos: pos(-39,129,-953), endPos: pos(-39,129,-902), faceOffset: "east", funnelOffset: [0,5,0] },
    { name: "左顶面1", startPos: pos(-31,130,-953), endPos: pos(-31,130,-902), faceOffset: "down", funnelOffset: [-1,8,0] },
    { name: "右顶面1", startPos: pos(-37,130,-953), endPos: pos(-37,130,-902), faceOffset: "down", funnelOffset: [1,8,0] },
];

const BASE_BLOCK = "minecraft:calcite";   // 基底方块
const MAX_ITEMS_LENGTH = 1000;            // 扫描长度上限

// ===== 初始化 =====
const ItemList = Client.getRegisteredItems();
const Block2Item = new Map();
Client.getRegisteredItems().forEach(item => {
    if (item.isBlockItem() && item.getId().includes("minecraft"))
        Block2Item.set(item.getBlock().getId(), item.getId());
});
// 花盆特殊映射
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

// 缓存展示框物品
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
    if (i % 10 === 0 && i > 0) Client.waitTick(1);//10命令冷却1gt
});
Chat.log("全部命令执行完毕");
GlobalVars.putBoolean(scriptName, false);

// ===== 扫描单个面 =====
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

        const itemId = getItemId(current, cfg.faceOffset);
        const funnelPos = current.offset(cfg.funnelOffset[0], cfg.funnelOffset[1], cfg.funnelOffset[2]);
        const cmds = buildFunnelCommands(funnelPos, itemId);
        cmds.forEach(c => commandsToExecute.push(c));

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
        return frameItem.getItemId();
    }

    const block = World.getBlock(pos);
    const blockId = block.getId();

    // 非基底、非空气 → 直接映射为物品
    if (blockId !== BASE_BLOCK && blockId !== "minecraft:air") {
        const item = Block2Item.get(blockId.replace("wall_", ""));
        if (item) return item;
    }

    // 附着方块检查
    const attachedBlock = World.getBlock(checkPos);
    if (attachedBlock.getId() !== "minecraft:air") {
        const item = Block2Item.get(attachedBlock.getId().replace("wall_", ""));
        if (item) return item;
    }

    return null; // 无物品
}

// 生成漏斗修改命令组
function buildFunnelCommands(funnelPos, itemId) {
    const x = funnelPos.getX(), y = funnelPos.getY(), z = funnelPos.getZ();
    const cmds = [];

    // 空气 → 设为乐色A
    if (!itemId || itemId === "minecraft:air") {
        cmds.push(`/data modify block ${x} ${y} ${z} Items[0] set value {Slot:0b,id:"minecraft:gold_nugget",count:1b,components:{"minecraft:custom_name":"填充物A"}}`);
        return cmds;
    }

    const itemStack = ItemList.find(i => i.getId() === itemId)?.getDefaultStack();
    if (!itemStack) {
        Chat.log(`[错误] 未找到物品: ${itemId}`);
        return cmds;
    }
    const maxCount = itemStack.getMaxCount();
    const idShort = itemId.replace("minecraft:", "");

    if (maxCount === 1) {
        // 不应出现不可堆叠物品，报错并跳过
        Chat.log(`[错误] 检测到不可堆叠物品: ${itemId}，已跳过漏斗修改 (${x},${y},${z})`);
        return cmds;
    }

    if (maxCount === 16) {
        // 16 堆叠 → slot0 放 1 个，slot3、slot4 各 -1
        cmds.push(`/data modify block ${x} ${y} ${z} Items[0] set value {Slot:0b,id:"${idShort}",count:1b}`);
        cmds.push(`/data modify block ${x} ${y} ${z} Items[1] set value {Slot:1b,id:"minecraft:iron_nugget",count:5b,components:{"minecraft:custom_name":"填充物B"}}`);
        cmds.push(`/data modify block ${x} ${y} ${z} Items[2] set value {Slot:2b,id:"minecraft:iron_nugget",count:5b,components:{"minecraft:custom_name":"填充物B"}}`);
        cmds.push(`/data modify block ${x} ${y} ${z} Items[3] set value {Slot:3b,id:"minecraft:iron_nugget",count:4b,components:{"minecraft:custom_name":"填充物B"}}`);
        cmds.push(`/data modify block ${x} ${y} ${z} Items[4] set value {Slot:4b,id:"minecraft:iron_nugget",count:4b,components:{"minecraft:custom_name":"填充物B"}}`);
    } else {
        // 64 堆叠 → slot0 放 2 个
        cmds.push(`/data modify block ${x} ${y} ${z} Items[0] set value {Slot:0b,id:"${idShort}",count:2b}`);
        cmds.push(`/data modify block ${x} ${y} ${z} Items[1] set value {Slot:1b,id:"minecraft:iron_nugget",count:5b,components:{"minecraft:custom_name":"填充物B"}}`);
        cmds.push(`/data modify block ${x} ${y} ${z} Items[2] set value {Slot:2b,id:"minecraft:iron_nugget",count:5b,components:{"minecraft:custom_name":"填充物B"}}`);
        cmds.push(`/data modify block ${x} ${y} ${z} Items[3] set value {Slot:3b,id:"minecraft:iron_nugget",count:5b,components:{"minecraft:custom_name":"填充物B"}}`);
        cmds.push(`/data modify block ${x} ${y} ${z} Items[4] set value {Slot:4b,id:"minecraft:iron_nugget",count:5b,components:{"minecraft:custom_name":"填充物B"}}`);
    }
    return cmds;
}