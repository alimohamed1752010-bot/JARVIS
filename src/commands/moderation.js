const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { execute } = require('../core/executor');
module.exports = {
  data:new SlashCommandBuilder().setName("ban").setDescription("Ban a member.")
    .addUserOption(o=>o.setName("user").setDescription("Member to ban").setRequired(true))
    .addStringOption(o=>o.setName("reason").setDescription("Reason"))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  async execute(interaction,{getConfig,saveConfig}){
    const user=interaction.options.getUser("user"), reason=interaction.options.getString("reason")||"Slash command ban.";
    const member=await interaction.guild.members.fetch(user.id).catch(()=>null); if(!member)return interaction.reply({content:"I can't find that member in this server.",ephemeral:true});
    const result=await execute({message:interaction,action:'ban',target:member,reason,config:getConfig(interaction.guild.id),saveConfig});
    return interaction.reply({content:result.ok?`🔨 **${user.tag}** has been banned.`:result.text,ephemeral:!result.ok});
  }
};
