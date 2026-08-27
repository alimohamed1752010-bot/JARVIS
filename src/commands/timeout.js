const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { execute } = require('../core/executor');
module.exports = {
  data: new SlashCommandBuilder().setName("timeout").setDescription("Timeout a member.")
    .addUserOption(o=>o.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption(o=>o.setName("minutes").setDescription("Minutes").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o=>o.setName("reason").setDescription("Reason"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  async execute(interaction,{getConfig,saveConfig}){
    const user=interaction.options.getUser("user"), minutes=interaction.options.getInteger("minutes"), reason=interaction.options.getString("reason")||"Slash command timeout.";
    const member=await interaction.guild.members.fetch(user.id).catch(()=>null); if(!member)return interaction.reply({content:"I can't find that member.",ephemeral:true});
    const result=await execute({message:interaction,action:'timeout',target:member,reason,durationMs:minutes*60000,config:getConfig(interaction.guild.id),saveConfig});
    return interaction.reply({content:result.ok?`⏳ **${user.tag}** timed out for **${minutes} minutes**.`:result.text,ephemeral:!result.ok});
  }
};
