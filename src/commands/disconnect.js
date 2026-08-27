const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { execute } = require('../core/executor');
module.exports = {
  data: new SlashCommandBuilder().setName("disconnect").setDescription("Disconnect a member from their current voice channel.")
    .addUserOption(o=>o.setName("user").setDescription("Member to disconnect").setRequired(true))
    .addStringOption(o=>o.setName("reason").setDescription("Reason"))
    .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),
  async execute(interaction,{getConfig,saveConfig}){
    const user=interaction.options.getUser("user"), reason=interaction.options.getString("reason")||"Slash command voice disconnect.";
    const member=await interaction.guild.members.fetch(user.id).catch(()=>null);
    if(!member)return interaction.reply({content:"I can't find that member in this server.",ephemeral:true});
    const result=await execute({message:interaction,action:'voicedisconnect',target:member,reason,config:getConfig(interaction.guild.id),saveConfig});
    return interaction.reply({content:result.ok?`🔌 **${user.tag}** disconnected from voice.`:result.text,ephemeral:!result.ok});
  }
};
