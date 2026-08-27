const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { execute } = require('../core/executor');
module.exports = {
  data: new SlashCommandBuilder().setName("kick").setDescription("Kick a member.")
    .addUserOption(o=>o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption(o=>o.setName("reason").setDescription("Reason"))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  async execute(interaction,{getConfig,saveConfig}){
    const user=interaction.options.getUser("user"), reason=interaction.options.getString("reason")||"Slash command kick.";
    const member=await interaction.guild.members.fetch(user.id).catch(()=>null); if(!member)return interaction.reply({content:"I can't find that member.",ephemeral:true});
    const result=await execute({message:interaction,action:'kick',target:member,reason,config:getConfig(interaction.guild.id),saveConfig});
    return interaction.reply({content:result.ok?`👢 **${user.tag}** has been kicked.`:result.text,ephemeral:!result.ok});
  }
};
